import { el } from "../lib/dom";
import { on } from "../lib/bus";
import { liveTools, runTool, webmcpHealth } from "../webmcp/context";
import type { ToolSpec } from "../game/types";

interface InputProperty {
  type?: string;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  examples?: unknown[];
  minimum?: number;
  maximum?: number;
}

interface InputSchema {
  properties?: Record<string, InputProperty>;
  required?: string[];
}

/** Render the in-page Agent Kit and return a disposer for its live-tool listener. */
export function renderConsolePanel(body: HTMLElement): () => void {
  const status = el("div", "console-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-atomic", "true");
  body.appendChild(status);

  const deck = el("div", "console-deck");
  const inventory = el("section", "console-inventory");
  const inventoryHead = el("div", "console-section-head", "TOOL INVENTORY");

  const list = el("div", "console-list");
  list.setAttribute("aria-label", "Live CROSSTALK tools");
  inventory.append(inventoryHead, list);

  const workbench = el("section", "console-workbench");
  const workbenchHead = el("div", "console-section-head", "SELECTED TOOL / TEST BENCH");
  const runBox = el("section", "console-run");
  runBox.setAttribute("aria-label", "Selected tool controls");

  const receipt = el("section", "console-receipt");
  receipt.innerHTML = `<h3>LAST INVOCATION RECEIPT</h3>`;
  const receiptOut = el("pre", "console-out", "No tool invoked from this kit yet.");
  receiptOut.setAttribute("role", "status");
  receiptOut.setAttribute("aria-live", "polite");
  receiptOut.setAttribute("aria-atomic", "true");
  receipt.appendChild(receiptOut);
  workbench.append(workbenchHead, runBox, receipt);
  deck.append(inventory, workbench);
  body.appendChild(deck);

  let selected: ToolSpec | null = null;
  let listedSignature = "";

  const paintStatus = (): void => {
    const health = webmcpHealth();
    status.innerHTML =
      health.mode === "ready"
        ? `<span class="ok" aria-hidden="true">●</span> <b>WebMCP ready.</b> ${health.ready} of ${health.desired} page tools are registered; an agent still needs this page and its briefing.`
        : health.mode === "connecting"
          ? `<span class="warn" aria-hidden="true">●</span> <b>WebMCP connecting.</b> ${health.ready} of ${health.desired} page tools are registered. Local controls remain available below.`
          : health.mode === "degraded"
            ? `<span class="fail" aria-hidden="true">●</span> <b>WebMCP degraded.</b> ${health.ready} of ${health.desired} page tools are ready; ${health.failed} failed. Use these local controls as a fallback.`
            : `<span class="warn" aria-hidden="true">●</span> <b>Solo controls ready.</b> WebMCP transport is unavailable here, but this kit invokes the same local tool handlers.`;
  };

  const paintSelection = (): void => {
    list.querySelectorAll<HTMLButtonElement>(".console-tool").forEach((item) => {
      const active = item.dataset.toolName === selected?.name;
      item.classList.toggle("is-selected", active);
      item.setAttribute("aria-pressed", String(active));
    });
  };

  const paintRun = (): void => {
    runBox.innerHTML = "";
    if (!selected) {
      runBox.appendChild(el("div", "hint", "Select a tool card to inspect and invoke it."));
      return;
    }

    const spec = selected;
    const title = el("h3", "console-run-title", `INVOKE ${spec.name}`);
    runBox.appendChild(title);

    const schema = el("details", "console-schema");
    const schemaPre = el("pre");
    schemaPre.textContent = JSON.stringify(spec.inputSchema, null, 2);
    const schemaSummary = el("summary", undefined, "VIEW INPUT SCHEMA");
    schema.append(schemaSummary, schemaPre);
    runBox.appendChild(schema);

    const editor = buildArgumentEditor(spec);
    runBox.appendChild(editor.node);
    const run = el("button", "btn btn-primary", `RUN ${spec.name}`);
    run.addEventListener("click", () => {
      void (async () => {
        let args: Record<string, unknown>;
        try {
          args = editor.read();
        } catch (error) {
          receiptOut.textContent = error instanceof Error ? error.message : String(error);
          receipt.scrollIntoView({ block: "nearest" });
          return;
        }
        run.disabled = true;
        run.textContent = "RUNNING…";
        receiptOut.textContent = `Running ${spec.name}…`;
        try {
          receiptOut.textContent = `${spec.name}\n${await runTool(spec, args)}`;
        } finally {
          if (run.isConnected) {
            run.disabled = false;
            run.textContent = `RUN ${spec.name}`;
          }
        }
      })();
    });
    runBox.appendChild(run);
  };

  const paintList = (): void => {
    const focusedName =
      document.activeElement instanceof HTMLElement && document.activeElement.classList.contains("console-tool")
        ? document.activeElement.dataset.toolName
        : null;
    const tools = liveTools();
    const signature = tools.map((tool) => `${tool.name}:${tool.readOnly ? "r" : "w"}`).join("|");
    if (signature === listedSignature) return;
    listedSignature = signature;
    const selectedName = selected?.name ?? null;
    if (selected) selected = tools.find((tool) => tool.name === selected!.name) ?? null;
    list.innerHTML = "";
    list.appendChild(el("div", "console-count", `${tools.length} LIVE TOOL${tools.length === 1 ? "" : "S"} — SET CHANGES WITH DEVICE STATE`));
    if (!selected && tools.length > 0) selected = tools[0];
    const addTool = (spec: ToolSpec, index: number): void => {
      const item = el("button", "console-tool");
      item.dataset.toolName = spec.name;
      item.setAttribute("aria-pressed", "false");
      item.style.setProperty("--tool-index", String(index + 1));
      const name = el("span", "tool-name", spec.name);
      const kind = el("span", spec.readOnly ? "tool-ro" : "tool-rw", spec.readOnly ? "read-only" : "actuator");
      const description = el(
        "span",
        "tool-desc",
        `${spec.description.slice(0, 150)}${spec.description.length > 150 ? "…" : ""}`
      );
      item.append(name, kind, description);
      item.addEventListener("click", () => {
        selected = spec;
        paintSelection();
        paintRun();
      });
      list.appendChild(item);
    };
    const reads = tools.filter((tool) => tool.readOnly);
    const actions = tools.filter((tool) => !tool.readOnly);
    if (reads.length) {
      list.appendChild(el("div", "console-group-label", `SENSOR + MANUAL / ${reads.length}`));
      reads.forEach(addTool);
    }
    if (actions.length) {
      list.appendChild(el("div", "console-group-label is-action", `REMOTE ACTUATION / ${actions.length}`));
      actions.forEach((tool, index) => addTool(tool, reads.length + index));
    }
    paintSelection();
    if (selectedName !== selected?.name) paintRun();
    if (focusedName) {
      [...list.querySelectorAll<HTMLButtonElement>(".console-tool")]
        .find((item) => item.dataset.toolName === focusedName)
        ?.focus({ preventScroll: true });
    }
  };

  paintStatus();
  paintRun();
  paintList();
  const unsubscribe = on("tools", () => {
    paintStatus();
    paintList();
  });
  return () => unsubscribe();
}

function buildArgumentEditor(spec: ToolSpec): { node: HTMLElement; read: () => Record<string, unknown> } {
  const schema = spec.inputSchema as InputSchema;
  const properties = Object.entries(schema.properties ?? {});
  if (properties.length === 0) {
    return { node: el("div", "console-no-args", "NO ARGUMENTS REQUIRED"), read: () => ({}) };
  }

  const supported = properties.every(([, property]) =>
    Boolean(property.enum?.length || property.type === "string" || property.type === "number" || property.type === "integer" || property.type === "boolean")
  );
  if (!supported) return jsonFallback(spec);

  const form = el("div", "console-fields");
  const readers: Array<() => [string, unknown]> = [];
  properties.forEach(([name, property], index) => {
    const id = `tool-arg-${spec.name}-${index}`;
    const field = el("div", "console-field");
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = `${name}${schema.required?.includes(name) ? " · REQUIRED" : ""}`;
    field.appendChild(label);

    let control: HTMLInputElement | HTMLSelectElement;
    if (property.enum?.length) {
      const select = document.createElement("select");
      property.enum.forEach((value, valueIndex) => {
        const option = document.createElement("option");
        option.value = String(valueIndex);
        option.textContent = String(value);
        select.appendChild(option);
      });
      control = select;
      readers.push(() => [name, property.enum![Number(select.value)]]);
    } else {
      const input = document.createElement("input");
      if (property.type === "boolean") {
        input.type = "checkbox";
        input.checked = Boolean(property.default);
        readers.push(() => [name, input.checked]);
      } else if (property.type === "number" || property.type === "integer") {
        input.type = "number";
        input.step = property.type === "integer" ? "1" : "any";
        if (property.minimum !== undefined) input.min = String(property.minimum);
        if (property.maximum !== undefined) input.max = String(property.maximum);
        input.value = String(numberDefault(property));
        readers.push(() => {
          const value = Number(input.value);
          if (!Number.isFinite(value)) throw new Error(`${name} must be a valid number.`);
          return [name, value];
        });
      } else {
        input.type = "text";
        input.value = typeof property.default === "string" ? property.default : "";
        readers.push(() => [name, input.value]);
      }
      control = input;
    }
    control.id = id;
    field.appendChild(control);
    if (property.description) {
      const help = el("small", "console-field-help", property.description);
      help.id = `${id}-help`;
      control.setAttribute("aria-describedby", help.id);
      field.appendChild(help);
    }
    form.appendChild(field);
  });
  return { node: form, read: () => Object.fromEntries(readers.map((read) => read())) };
}

function jsonFallback(spec: ToolSpec): { node: HTMLElement; read: () => Record<string, unknown> } {
  const wrap = el("div", "console-field");
  const id = `tool-json-${spec.name}`;
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = "ARGUMENTS · JSON";
  const textarea = el("textarea", "console-args");
  textarea.id = id;
  textarea.rows = 4;
  textarea.value = JSON.stringify(defaultArgs(spec), null, 2);
  wrap.append(label, textarea);
  return {
    node: wrap,
    read: () => {
      try {
        return textarea.value.trim() ? (JSON.parse(textarea.value) as Record<string, unknown>) : {};
      } catch {
        throw new Error("Arguments must be valid JSON.");
      }
    }
  };
}

function defaultArgs(spec: ToolSpec): Record<string, unknown> {
  const schema = spec.inputSchema as InputSchema;
  return Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([name, property]) => {
      if (property.enum?.length) return [name, property.enum[0]];
      if (property.type === "number" || property.type === "integer") return [name, numberDefault(property)];
      if (property.type === "boolean") return [name, Boolean(property.default)];
      return [name, typeof property.default === "string" ? property.default : ""];
    })
  );
}

function numberDefault(property: InputProperty): number {
  if (typeof property.default === "number") return property.default;
  const example = property.examples?.find((value) => typeof value === "number");
  if (typeof example === "number") return example;
  const described = property.description?.match(/(?:e\.g\.?|example:?)[^\d-]*(-?\d+(?:\.\d+)?)/i)?.[1];
  if (described !== undefined) return Number(described);
  return property.minimum ?? 1;
}
