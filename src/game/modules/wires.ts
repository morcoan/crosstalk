import type { GameModule, ModuleCtx, ToolSpec } from "../types";
import { sfx } from "../../lib/audio";

/**
 * WIRE BAY — asymmetry: the wire colors are painted enamel (human-visible only),
 * cutting is a physical act (human-only). The agent owns the rulebook and the
 * machine-readable serial tag. Neither side can solve it alone.
 */

export const WIRE_COLORS = ["red", "blue", "yellow", "white", "black", "green"] as const;
export type WireColor = (typeof WIRE_COLORS)[number];

/**
 * The single source of truth for wire logic. The manual text in manual.ts is
 * written to match this function EXACTLY, and test/rules.test.ts guards the pact.
 * Wires are numbered top to bottom starting at 1. Returns the 0-based index to cut.
 */
export function correctWireIndex(colors: WireColor[], serialLastDigitOdd: boolean): number {
  const n = colors.length;
  const count = (c: WireColor) => colors.filter((x) => x === c).length;
  const last = colors[n - 1];
  const lastIndexOf = (c: WireColor) => colors.lastIndexOf(c);

  if (n === 3) {
    if (count("red") === 0) return 1; // cut the second wire
    if (last === "white") return n - 1; // cut the last wire
    if (count("blue") > 1) return lastIndexOf("blue"); // cut the last blue wire
    return 0; // cut the first wire
  }
  if (n === 4) {
    if (count("yellow") > 1 && serialLastDigitOdd) return lastIndexOf("yellow"); // last yellow
    if (count("blue") === 0) return 0; // first wire
    if (count("green") === 1) return colors.indexOf("green"); // the green wire
    return n - 1; // last wire
  }
  if (n === 5) {
    if (last === "black" && !serialLastDigitOdd) return 3; // fourth wire
    if (count("red") === 1 && count("green") > 1) return colors.indexOf("red"); // the red wire
    if (count("yellow") === 0) return 1; // second wire
    return 0; // first wire
  }
  throw new Error(`unsupported wire count ${n}`);
}

interface WireState {
  color: WireColor;
  cut: boolean;
}

export class WiresModule implements GameModule {
  readonly kind = "wires" as const;
  readonly label = "WIRE BAY";
  status: "armed" | "solved" = "armed";

  private wires: WireState[];
  private correct: number;
  private root: HTMLElement | null = null;
  private pendingCut: number | null = null;

  constructor(
    private ctx: ModuleCtx,
    wireCount: 3 | 4 | 5
  ) {
    const colors: WireColor[] = [];
    for (let i = 0; i < wireCount; i++) colors.push(ctx.rng.pick(WIRE_COLORS));
    this.wires = colors.map((color) => ({ color, cut: false }));
    const lastDigit = Number(this.ctx.serial[this.ctx.serial.length - 1]);
    this.correct = correctWireIndex(colors, lastDigit % 2 === 1);
  }

  agentSummary(): string {
    const cut = this.wires.filter((w) => w.cut).length;
    return (
      `${this.wires.length} wires present${cut ? ` (${cut} already cut)` : ""}. ` +
      `Wire colors are painted enamel — NOT machine-readable. Ask your partner to read the colors top to bottom. ` +
      `Cutting is manual-only; rules are in manual section "wires" (you will also need scan_data_tag).`
    );
  }

  tools(): ToolSpec[] {
    return []; // this module is deliberately human-actuated; the agent contributes rules + serial
  }

  render(root: HTMLElement): void {
    this.root = root;
    root.innerHTML = "";
    const bay = document.createElement("div");
    bay.className = "wire-bay";
    this.wires.forEach((wire, i) => {
      const row = document.createElement("button");
      row.className = `wire wire-${wire.color}${wire.cut ? " is-cut" : ""}`;
      row.disabled = wire.cut || this.status === "solved" || !this.ctx.missionLive();
      row.setAttribute("aria-label", `wire ${i + 1}, ${wire.color}${wire.cut ? ", cut" : ""}`);
      row.innerHTML = `
        <span class="wire-num">${i + 1}</span>
        <span class="wire-line"><span class="wire-core"></span></span>
        <span class="wire-color">${wire.color.toUpperCase()}</span>
        <span class="wire-tag">${wire.cut ? "CUT" : ""}</span>`;
      row.addEventListener("click", () => this.askCut(i));
      bay.appendChild(row);
    });

    const confirm = document.createElement("div");
    confirm.className = "confirm-strip";
    confirm.dataset.role = "confirm";
    bay.appendChild(confirm);
    root.appendChild(bay);
    this.renderConfirm();
  }

  private askCut(i: number): void {
    if (this.status === "solved" || this.wires[i].cut) return;
    sfx.click();
    this.pendingCut = this.pendingCut === i ? null : i;
    this.renderConfirm();
  }

  private renderConfirm(): void {
    const strip = this.root?.querySelector<HTMLElement>('[data-role="confirm"]');
    if (!strip) return;
    if (this.pendingCut === null) {
      strip.innerHTML = `<span class="hint">Select a wire, then confirm the cut. Cuts are permanent.</span>`;
      return;
    }
    const i = this.pendingCut;
    const color = this.wires[i].color;
    strip.innerHTML = "";
    const label = document.createElement("span");
    label.className = "confirm-label";
    label.textContent = `CUT WIRE ${i + 1} (${color.toUpperCase()})?`;
    const btn = document.createElement("button");
    btn.className = "btn btn-danger";
    btn.textContent = "CONFIRM CUT";
    btn.addEventListener("click", () => this.cut(i));
    const cancel = document.createElement("button");
    cancel.className = "btn btn-ghost";
    cancel.textContent = "CANCEL";
    cancel.addEventListener("click", () => {
      this.pendingCut = null;
      this.renderConfirm();
    });
    strip.append(label, btn, cancel);
  }

  private cut(i: number): void {
    if (!this.ctx.missionLive() || this.wires[i].cut) return;
    sfx.click();
    this.ctx.humanAction(true);
    this.pendingCut = null;
    this.wires[i].cut = true;
    if (i === this.correct) {
      this.status = "solved";
      this.ctx.feed(`Wire ${i + 1} (${this.wires[i].color}) cut — WIRE BAY disarmed.`, "good");
      this.ctx.solve();
    } else {
      this.ctx.feed(`Wire ${i + 1} (${this.wires[i].color}) cut — WRONG WIRE.`, "bad");
      this.ctx.strike(`wrong wire cut (wire ${i + 1})`);
    }
    this.ctx.update();
  }
}
