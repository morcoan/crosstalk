import { el, esc } from "../lib/dom";
import { on } from "../lib/bus";
import { liveTools, runTool, webmcpAvailable } from "../webmcp/context";
import type { ToolSpec } from "../game/types";

/**
 * WebMCP Tool Console — a transparent window into the agent's side of the game.
 * Lists every live tool (the exact set a connected agent sees) and lets a human
 * invoke them through the very same execute path. Useful for judges without an
 * agent attached, for debugging, and for understanding the asymmetry design.
 */
export function renderConsolePanel(body: HTMLElement): void {
  const status = el(
    "div",
    "console-status",
    webmcpAvailable()
      ? `<span class="ok">●</span> WebMCP detected — these tools are registered on <code>document.modelContext</code> right now.`
      : `<span class="warn">●</span> WebMCP not detected in this browser. The same tools are listed below and remain invokable here — this console calls the identical <code>execute()</code> an agent would.`
  );
  body.appendChild(status);

  const list = el("div", "console-list");
  body.appendChild(list);

  const runBox = el("div", "console-run");
  body.appendChild(runBox);

  let selected: ToolSpec | null = null;

  const paintRun = (): void => {
    runBox.innerHTML = "";
    if (!selected) {
      runBox.appendChild(el("div", "hint", "Select a tool to invoke it."));
      return;
    }
    const spec = selected;
    runBox.appendChild(el("div", "console-run-title", `INVOKE <b>${esc(spec.name)}</b>`));
    const schema = el("details", "console-schema");
    schema.innerHTML = `<summary>inputSchema</summary><pre>${esc(JSON.stringify(spec.inputSchema, null, 2))}</pre>`;
    runBox.appendChild(schema);
    const ta = el("textarea", "console-args");
    ta.rows = 3;
    ta.value = defaultArgs(spec);
    runBox.appendChild(ta);
    const run = el("button", "btn btn-primary", "RUN TOOL");
    const out = el("pre", "console-out", "");
    run.addEventListener("click", () => {
      void (async () => {
        let args: Record<string, unknown> = {};
        try {
          args = ta.value.trim() ? (JSON.parse(ta.value) as Record<string, unknown>) : {};
        } catch {
          out.textContent = "Arguments must be valid JSON.";
          return;
        }
        out.textContent = "…";
        out.textContent = await runTool(spec, args);
      })();
    });
    runBox.append(run, out);
  };

  const paintList = (): void => {
    const tools = liveTools();
    list.innerHTML = "";
    list.appendChild(
      el("div", "console-count", `${tools.length} LIVE TOOL${tools.length === 1 ? "" : "S"} — the set changes with game state`)
    );
    tools.forEach((spec) => {
      const item = el("button", `console-tool${selected?.name === spec.name ? " is-selected" : ""}`);
      item.innerHTML = `
        <span class="tool-name">${esc(spec.name)}</span>
        ${spec.readOnly ? '<span class="tool-ro">read-only</span>' : '<span class="tool-rw">actuator</span>'}
        <span class="tool-desc">${esc(spec.description.slice(0, 120))}${spec.description.length > 120 ? "…" : ""}</span>`;
      item.addEventListener("click", () => {
        selected = spec;
        paintList();
        paintRun();
      });
      list.appendChild(item);
    });
    if (selected && !tools.some((t) => t.name === selected!.name)) {
      selected = null;
      paintRun();
    }
  };

  paintList();
  paintRun();
  on("tools", paintList);
}

function defaultArgs(spec: ToolSpec): string {
  const schema = spec.inputSchema as { properties?: Record<string, { enum?: unknown[]; type?: string }> };
  const props = schema.properties ?? {};
  const keys = Object.keys(props);
  if (keys.length === 0) return "{}";
  const sample: Record<string, unknown> = {};
  for (const key of keys) {
    const p = props[key];
    if (p.enum?.length) sample[key] = p.enum[0];
    else if (p.type === "number") sample[key] = 0;
    else sample[key] = "";
  }
  return JSON.stringify(sample);
}
