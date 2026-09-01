import { emit } from "../lib/bus";
import { sfx } from "../lib/audio";
import { feed, game, syncMissionClock, type DeviceState } from "../game/state";
import type { ToolExecutionOptions, ToolSpec } from "../game/types";

/** Thin, failure-aware adapter between game ToolSpecs and the WebMCP surface. */

type ModelContextLike = {
  registerTool(tool: object, options?: { signal?: AbortSignal }): Promise<void> | void;
};

export type ToolRegistrationState = "local-only" | "registering" | "ready" | "failed" | "retiring";

export interface LiveTool {
  spec: ToolSpec;
  owner: unknown;
  controller: AbortController;
  state: ToolRegistrationState;
  attempts: number;
  error: string | null;
  inFlight: number;
  desired: boolean;
  contextVersion: number;
  registrationToken: number;
  retryHandle: number | null;
  needsRebind: boolean;
}

export interface WebMcpHealth {
  available: boolean;
  mode: "local-only" | "connecting" | "ready" | "degraded";
  contextVersion: number;
  desired: number;
  ready: number;
  registering: number;
  failed: number;
  retiring: number;
  failures: { name: string; attempts: number; message: string }[];
}

const live = new Map<string, LiveTool>();
const retiring = new Map<string, Set<LiveTool>>();
const scheduled = new Set<number>();
const monitorCleanups: (() => void)[] = [];
const REGISTRATION_RETRY_MS = [120, 400, 1200] as const;
const CONTEXT_PROBE_MS = [50, 150, 400, 1000, 2500] as const;

let activeContext: ModelContextLike | null = null;
let contextVersion = 0;
let monitoring = false;
let absentContextProbe: number | null = null;

function getModelContext(): ModelContextLike | null {
  try {
    const doc = typeof document === "undefined"
      ? undefined
      : (document as Document & { modelContext?: ModelContextLike });
    const nav = typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { modelContext?: ModelContextLike });
    const candidate = doc?.modelContext ?? nav?.modelContext;
    return candidate && typeof candidate.registerTool === "function" ? candidate : null;
  } catch {
    return null;
  }
}

function schedule(fn: () => void, ms: number): number {
  const handle = globalThis.setTimeout(() => {
    scheduled.delete(handle);
    fn();
  }, ms);
  scheduled.add(handle);
  return handle;
}

function cancelScheduled(handle: number | null): void {
  if (handle === null) return;
  globalThis.clearTimeout(handle);
  scheduled.delete(handle);
}

export function webmcpAvailable(): boolean {
  return getModelContext() !== null;
}

/** Local desired tools. They remain usable in AGENT KIT even if native registration is unavailable. */
export function liveTools(): ToolSpec[] {
  return [...live.values()].map((tool) => tool.spec);
}

export function webmcpHealth(): WebMcpHealth {
  const rows = [...live.values()];
  const ready = rows.filter((row) => row.state === "ready").length;
  const registering = rows.filter((row) => row.state === "registering").length;
  const failedRows = rows.filter((row) => row.state === "failed");
  const retiringCount = [...retiring.values()].reduce((sum, set) => sum + set.size, 0);
  const available = getModelContext() !== null;
  const mode: WebMcpHealth["mode"] = !available
    ? "local-only"
    : failedRows.length > 0
      ? "degraded"
      : rows.length > 0 && ready === rows.length
        ? "ready"
        : "connecting";
  return {
    available,
    mode,
    contextVersion,
    desired: rows.length,
    ready,
    registering,
    failed: failedRows.length,
    retiring: retiringCount,
    failures: failedRows.map((row) => ({
      name: row.spec.name,
      attempts: row.attempts,
      message: row.error ?? "Native registration failed."
    }))
  };
}

function summarizeArgs(input: Record<string, unknown>): string {
  const entries = Object.entries(input ?? {});
  if (entries.length === 0) return "";
  return entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ");
}

function preview(text: string, max = 110): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function statusSuffix(session: DeviceState | null): string {
  if (!session || game.device !== session || session.result !== null || !session.revealed) return "";
  syncMissionClock();
  if (game.device !== session || session.result !== null) return "";
  const total = Math.max(0, Math.ceil(session.msLeft / 1000));
  const clock = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  const armed = session.modules.filter((module) => module.status === "armed").length;
  return `\n[DEVICE: ${clock} left · strikes ${session.strikes}/3 · ${armed} module(s) still armed]`;
}

function expiredResult(): string {
  return "TOOL ERROR: This tool expired with its device state. Refresh the live tool list before acting.";
}

function cancelledResult(): string {
  return "TOOL ERROR: Tool execution was cancelled before it began. No action was taken.";
}

function isCurrent(record: LiveTool): boolean {
  return record.desired && live.get(record.spec.name) === record;
}

async function executeSpec(
  spec: ToolSpec,
  input: Record<string, unknown>,
  options: ToolExecutionOptions = {}
): Promise<string> {
  const session = game.device && game.device.result === null ? game.device : null;
  if (options.signal?.aborted) return cancelledResult();
  if (session) {
    session.toolCalls++;
    session.telemetry.toolUsage[spec.name] = (session.telemetry.toolUsage[spec.name] ?? 0) + 1;
    if (spec.readOnly) session.telemetry.agentReads++;
    else session.telemetry.agentActuations++;
  }
  try {
    const args = summarizeArgs(input);
    sfx.radio();
    feed(`AGENT ⚙ ${spec.name}${args ? ` (${args})` : ""}`, "tool");
    let output = String(await spec.execute(input ?? {}, options));
    if (!spec.readOnly) output += statusSuffix(session);
    feed(`↳ ${preview(output)}`, "info");
    emit("state");
    return output;
  } catch (error) {
    if (session) session.telemetry.toolErrors++;
    const message = error instanceof Error ? error.message : String(error);
    feed(`↳ TOOL ERROR: ${preview(message)}`, "bad");
    emit("state");
    return `TOOL ERROR: ${message}`;
  }
}

function finishRetirement(record: LiveTool): void {
  if (record.inFlight > 0) return;
  cancelScheduled(record.retryHandle);
  record.retryHandle = null;
  record.registrationToken++;
  record.controller.abort();
  const set = retiring.get(record.spec.name);
  set?.delete(record);
  if (set?.size === 0) retiring.delete(record.spec.name);
  const replacement = live.get(record.spec.name);
  if (replacement) beginNativeRegistration(replacement);
  emit("tools");
}

async function executeRecord(
  record: LiveTool,
  input: Record<string, unknown>,
  options: ToolExecutionOptions = {}
): Promise<string> {
  if (!isCurrent(record)) return expiredResult();
  if (options.signal?.aborted) return cancelledResult();
  syncMissionClock();
  if (!isCurrent(record)) return expiredResult();
  record.inFlight++;
  try {
    if (!isCurrent(record)) return expiredResult();
    return await executeSpec(record.spec, input, options);
  } finally {
    record.inFlight--;
    if (!record.desired) {
      // Let the successful execute result settle in the host before unregistering.
      schedule(() => finishRetirement(record), 0);
    } else if (record.needsRebind && record.inFlight === 0) {
      record.needsRebind = false;
      rebindRecord(record);
    }
  }
}

/** Shared execution path used by the in-page console. */
export async function runTool(
  spec: ToolSpec,
  input: Record<string, unknown>,
  options: ToolExecutionOptions = {}
): Promise<string> {
  const record = [...live.values()].find((row) => row.spec === spec);
  return record ? executeRecord(record, input ?? {}, options) : expiredResult();
}

function toRegistration(record: LiveTool): object {
  return {
    name: record.spec.name,
    title: record.spec.title,
    description: record.spec.description,
    inputSchema: record.spec.inputSchema,
    annotations: { readOnlyHint: record.spec.readOnly === true },
    execute: (input: Record<string, unknown>, options?: ToolExecutionOptions) =>
      executeRecord(record, input ?? {}, options)
  };
}

function hasRetiringRegistration(name: string): boolean {
  return (retiring.get(name)?.size ?? 0) > 0;
}

function beginNativeRegistration(record: LiveTool): void {
  if (!isCurrent(record)) return;
  const context = activeContext;
  if (!context) {
    record.state = "local-only";
    record.error = null;
    emit("tools");
    return;
  }
  if (hasRetiringRegistration(record.spec.name)) {
    record.state = "registering";
    return;
  }
  if (record.inFlight > 0) {
    record.needsRebind = true;
    record.state = "registering";
    return;
  }

  cancelScheduled(record.retryHandle);
  record.retryHandle = null;
  record.controller.abort();
  record.controller = new AbortController();
  record.contextVersion = contextVersion;
  record.state = "registering";
  record.error = null;
  record.attempts++;
  const token = ++record.registrationToken;
  const signal = record.controller.signal;
  emit("tools");

  void Promise.resolve()
    .then(() => context.registerTool(toRegistration(record), { signal }))
    .then(() => {
      if (!isCurrent(record) || record.registrationToken !== token || activeContext !== context || signal.aborted) return;
      record.state = "ready";
      record.error = null;
      emit("tools");
    })
    .catch((error: unknown) => {
      if (!isCurrent(record) || record.registrationToken !== token || activeContext !== context || signal.aborted) return;
      record.state = "failed";
      record.error = error instanceof Error ? error.message : String(error);
      emit("tools");
      const retryMs = REGISTRATION_RETRY_MS[record.attempts - 1];
      if (retryMs !== undefined) {
        record.retryHandle = schedule(() => beginNativeRegistration(record), retryMs);
      }
    });
}

function rebindRecord(record: LiveTool): void {
  if (!isCurrent(record)) return;
  if (record.inFlight > 0) {
    record.needsRebind = true;
    return;
  }
  cancelScheduled(record.retryHandle);
  record.retryHandle = null;
  record.registrationToken++;
  record.controller.abort();
  record.controller = new AbortController();
  record.attempts = 0;
  record.error = null;
  record.state = activeContext ? "registering" : "local-only";
  beginNativeRegistration(record);
}

function reconcileContext(): boolean {
  const next = getModelContext();
  if (next === activeContext) return false;
  activeContext = next;
  if (activeContext) {
    cancelScheduled(absentContextProbe);
    absentContextProbe = null;
  } else {
    scheduleAbsentContextProbe();
  }
  contextVersion++;
  for (const set of retiring.values()) {
    for (const record of set) {
      if (record.inFlight === 0) finishRetirement(record);
    }
  }
  for (const record of live.values()) rebindRecord(record);
  emit("tools");
  return true;
}

function scheduleAbsentContextProbe(): void {
  if (!monitoring || activeContext || absentContextProbe !== null) return;
  absentContextProbe = schedule(() => {
    absentContextProbe = null;
    reconcileContext();
    scheduleAbsentContextProbe();
  }, 2000);
}

export function refreshWebMcpContext(): WebMcpHealth {
  reconcileContext();
  return webmcpHealth();
}

function ensureContextMonitoring(): void {
  if (monitoring) return;
  monitoring = true;
  for (const delay of CONTEXT_PROBE_MS) schedule(() => reconcileContext(), delay);
  scheduleAbsentContextProbe();

  const listen = (target: EventTarget | undefined, event: string): void => {
    if (!target || typeof target.addEventListener !== "function") return;
    const handler = () => reconcileContext();
    target.addEventListener(event, handler);
    monitorCleanups.push(() => target.removeEventListener(event, handler));
  };
  listen(typeof window === "undefined" ? undefined : window, "focus");
  listen(typeof window === "undefined" ? undefined : window, "pageshow");
  listen(typeof document === "undefined" ? undefined : document, "visibilitychange");
}

function retireRecord(record: LiveTool): void {
  if (!record.desired) return;
  record.desired = false;
  record.state = "retiring";
  cancelScheduled(record.retryHandle);
  record.retryHandle = null;
  let set = retiring.get(record.spec.name);
  if (!set) {
    set = new Set();
    retiring.set(record.spec.name, set);
  }
  set.add(record);
  if (record.inFlight === 0) finishRetirement(record);
}

/** Reconcile the native and local toolsets against the current game state. */
export function syncTools(desired: { spec: ToolSpec; owner: unknown }[]): void {
  ensureContextMonitoring();
  reconcileContext();
  const wanted = new Map<string, { spec: ToolSpec; owner: unknown }>();
  for (const row of desired) {
    if (wanted.has(row.spec.name)) {
      console.error(`[webmcp] duplicate desired tool name "${row.spec.name}"; the last owner wins`);
    }
    wanted.set(row.spec.name, row);
  }

  for (const [name, record] of [...live]) {
    const want = wanted.get(name);
    if (!want || want.owner !== record.owner) {
      live.delete(name);
      retireRecord(record);
    }
  }

  for (const [name, want] of wanted) {
    if (live.has(name)) continue;
    const record: LiveTool = {
      spec: want.spec,
      owner: want.owner,
      controller: new AbortController(),
      state: activeContext ? "registering" : "local-only",
      attempts: 0,
      error: null,
      inFlight: 0,
      desired: true,
      contextVersion,
      registrationToken: 0,
      retryHandle: null,
      needsRebind: false
    };
    live.set(name, record);
    beginNativeRegistration(record);
  }
  emit("tools");
}

/** Test-only cleanup for module-isolated fault injection. */
export function resetWebMcpForTests(): void {
  for (const handle of [...scheduled]) globalThis.clearTimeout(handle);
  scheduled.clear();
  for (const record of live.values()) record.controller.abort();
  for (const set of retiring.values()) for (const record of set) record.controller.abort();
  live.clear();
  retiring.clear();
  monitorCleanups.splice(0).forEach((cleanup) => cleanup());
  activeContext = null;
  contextVersion = 0;
  monitoring = false;
  absentContextProbe = null;
}
