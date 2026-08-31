import { emit } from "../lib/bus";
import { feed, game } from "../game/state";
import type { ToolSpec } from "../game/types";

/**
 * Thin adapter between the game's ToolSpecs and the browser's WebMCP surface.
 *
 * - Uses document.modelContext (spec) with navigator.modelContext as a fallback
 *   for older preview builds.
 * - Every tool is registered with its own AbortController so the live toolset
 *   can mirror the game state exactly (solved module ⇒ its tools vanish).
 * - Every execution is logged to the on-screen activity feed and counted, so
 *   the human always SEES what their agent is doing — visibility is a core
 *   design goal of WebMCP and of this game.
 * - A local registry mirrors whatever is registered so the in-page Tool Console
 *   works even in browsers without WebMCP.
 */

type ModelContextLike = {
  registerTool(tool: object, options?: { signal?: AbortSignal }): Promise<void> | void;
};

function getModelContext(): ModelContextLike | null {
  const doc = document as Document & { modelContext?: ModelContextLike };
  const nav = navigator as Navigator & { modelContext?: ModelContextLike };
  return doc.modelContext ?? nav.modelContext ?? null;
}

export function webmcpAvailable(): boolean {
  return getModelContext() !== null;
}

export interface LiveTool {
  spec: ToolSpec;
  owner: unknown;
  controller: AbortController;
}

const live = new Map<string, LiveTool>();

export function liveTools(): ToolSpec[] {
  return [...live.values()].map((t) => t.spec);
}

function summarizeArgs(input: Record<string, unknown>): string {
  const entries = Object.entries(input ?? {});
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
}

function preview(text: string, max = 110): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Compact live-state suffix appended to actuator results so the agent keeps
 *  situational awareness without extra get_device_state round-trips. */
function statusSuffix(): string {
  const d = game.device;
  if (!d || d.result !== null || !d.revealed) return "";
  const total = Math.max(0, Math.ceil(d.msLeft / 1000));
  const clock = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  const armed = d.modules.filter((m) => m.status === "armed").length;
  return `\n[DEVICE: ${clock} left · strikes ${d.strikes}/3 · ${armed} module(s) still armed]`;
}

/** Shared execution path for real agents AND the in-page Tool Console. */
export async function runTool(spec: ToolSpec, input: Record<string, unknown>): Promise<string> {
  const session = game.device && game.device.result === null ? game.device : null;
  if (session) {
    session.toolCalls++;
    session.telemetry.toolUsage[spec.name] = (session.telemetry.toolUsage[spec.name] ?? 0) + 1;
    if (spec.readOnly) session.telemetry.agentReads++;
    else session.telemetry.agentActuations++;
  }
  const args = summarizeArgs(input);
  feed(`AGENT ⚙ ${spec.name}${args ? ` (${args})` : ""}`, "tool");
  try {
    let out = await spec.execute(input ?? {});
    if (!spec.readOnly) out += statusSuffix();
    feed(`↳ ${preview(out)}`, "info");
    emit("state");
    return out;
  } catch (err) {
    if (session) session.telemetry.toolErrors++;
    const msg = err instanceof Error ? err.message : String(err);
    feed(`↳ TOOL ERROR: ${preview(msg)}`, "bad");
    emit("state");
    // Return (not throw): every host reliably relays plain text back to the model.
    return `TOOL ERROR: ${msg}`;
  }
}

function toRegistration(spec: ToolSpec): object {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: { readOnlyHint: spec.readOnly === true },
    execute: (input: Record<string, unknown>) => runTool(spec, input)
  };
}

/**
 * Reconcile the set of registered tools with the desired set.
 * A tool is re-registered only when its owner changes (e.g. a new mission built
 * a new module instance), which keeps register/abort churn minimal.
 */
export function syncTools(desired: { spec: ToolSpec; owner: unknown }[]): void {
  const wanted = new Map(desired.map((d) => [d.spec.name, d]));

  const replaced: AbortController[] = [];
  const removed: AbortController[] = [];
  for (const [name, tool] of [...live]) {
    const want = wanted.get(name);
    if (!want) {
      removed.push(tool.controller);
      live.delete(name);
    } else if (want.owner !== tool.owner) {
      replaced.push(tool.controller);
      live.delete(name);
    }
  }
  // Same-name replacements (new mission, new module instance) must abort
  // synchronously so the fresh registration below never collides with a live
  // twin. Pure removals are deferred by a tick: a tool that solves a module
  // (e.g. lock_regulator) unregisters itself from inside its own execute(), and
  // aborting synchronously races the host's in-flight executeTool response —
  // the agent would see an error even though the action succeeded. Solved
  // modules answer gracefully during the 60 ms window.
  replaced.forEach((c) => c.abort());
  if (removed.length > 0) {
    setTimeout(() => removed.forEach((c) => c.abort()), 60);
  }

  const mc = getModelContext();
  for (const [name, want] of wanted) {
    if (live.has(name)) continue;
    const controller = new AbortController();
    live.set(name, { spec: want.spec, owner: want.owner, controller });
    if (mc) {
      try {
        void mc.registerTool(toRegistration(want.spec), { signal: controller.signal });
      } catch (err) {
        console.error(`[webmcp] failed to register ${name}`, err);
      }
    }
  }

  emit("tools");
}
