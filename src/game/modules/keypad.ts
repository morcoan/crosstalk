import type { GameModule, ModuleCtx, ToolSpec } from "../types";
import { sfx } from "../../lib/audio";

/**
 * GLYPH KEYPAD — asymmetry: the four glyphs are rendered pixels the agent cannot
 * see; the human can see them but has no idea what order to press. The agent owns
 * the three glyph columns in the manual. The human describes squiggles, the agent
 * resolves the one column containing all four, and dictates the press order.
 */

export interface Glyph {
  id: string;
  char: string;
  name: string;
  hint: string; // how a human might describe it
}

export const GLYPHS: Glyph[] = [
  { id: "omega", char: "Ω", name: "OMEGA", hint: "horseshoe standing on two feet" },
  { id: "moon", char: "☾", name: "CRESCENT", hint: "a waning crescent moon" },
  { id: "zhe", char: "Ж", name: "BEETLE", hint: "an X with a spine through it" },
  { id: "star", char: "★", name: "STAR", hint: "a filled five-point star" },
  { id: "ash", char: "Æ", name: "ASH", hint: "an A fused with an E" },
  { id: "pilcrow", char: "¶", name: "PILCROW", hint: "a backwards P paragraph mark" },
  { id: "delta", char: "Δ", name: "DELTA", hint: "an empty triangle" },
  { id: "slash", char: "Ø", name: "VOID", hint: "an O with a slash through it" },
  { id: "bolt", char: "ϟ", name: "BOLT", hint: "a lightning bolt" },
  { id: "psi", char: "Ψ", name: "TRIDENT", hint: "a pitchfork or trident" },
  { id: "dots", char: "∴", name: "THEREFORE", hint: "three dots in a triangle" },
  { id: "inf", char: "∞", name: "INFINITY", hint: "a sideways figure eight" },
  { id: "section", char: "§", name: "SECTION", hint: "two S shapes stacked" },
];

const byId = new Map(GLYPHS.map((g) => [g.id, g]));
export function glyph(id: string): Glyph {
  const g = byId.get(id);
  if (!g) throw new Error(`unknown glyph ${id}`);
  return g;
}

/**
 * Three manual columns. Construction guarantees each column has >= 2 glyphs unique
 * to it; generation always includes >= 1 unique glyph, so exactly one column
 * contains all four displayed glyphs. Guarded by test/rules.test.ts.
 */
export const KEYPAD_COLUMNS: string[][] = [
  ["omega", "moon", "zhe", "star", "ash", "pilcrow"],
  ["delta", "zhe", "pilcrow", "psi", "slash", "bolt"],
  ["dots", "star", "psi", "inf", "section", "moon"],
];

export function uniqueToColumn(col: number): string[] {
  return KEYPAD_COLUMNS[col].filter((id) =>
    KEYPAD_COLUMNS.every((other, i) => i === col || !other.includes(id))
  );
}

/** Columns that contain every one of the given glyph ids. */
export function columnsContainingAll(ids: string[]): number[] {
  const out: number[] = [];
  KEYPAD_COLUMNS.forEach((col, i) => {
    if (ids.every((id) => col.includes(id))) out.push(i);
  });
  return out;
}

export class KeypadModule implements GameModule {
  readonly kind = "keypad" as const;
  readonly label = "GLYPH KEYPAD";
  status: "armed" | "solved" = "armed";

  /** The four glyph ids as displayed on the keys (display order = shuffled). */
  private displayed: string[];
  /** The ids in required press order (order within the source column). */
  private order: string[];
  private progress = 0;
  private flashWrong = false;
  private root: HTMLElement | null = null;

  constructor(private ctx: ModuleCtx) {
    const col = ctx.rng.int(0, KEYPAD_COLUMNS.length - 1);
    const uniques = uniqueToColumn(col);
    const anchor = ctx.rng.pick(uniques);
    const rest = ctx.rng
      .shuffle(KEYPAD_COLUMNS[col].filter((id) => id !== anchor))
      .slice(0, 3);
    const chosen = [anchor, ...rest];
    this.order = KEYPAD_COLUMNS[col].filter((id) => chosen.includes(id));
    this.displayed = ctx.rng.shuffle(chosen);
  }

  agentSummary(): string {
    return (
      `4 glyph keys. Progress: ${this.progress}/4 pressed correctly. ` +
      `The glyphs are rendered pixels — NOT machine-readable. Ask your partner to describe all four, ` +
      `then match them against manual section "keypad" (exactly one column contains all four).`
    );
  }

  tools(): ToolSpec[] {
    return []; // keys are physical; the agent's contribution is the column lookup
  }

  render(root: HTMLElement): void {
    this.root = root;
    root.innerHTML = "";
    const pad = document.createElement("div");
    pad.className = `keypad${this.flashWrong ? " flash-wrong" : ""}`;
    this.displayed.forEach((id) => {
      const g = glyph(id);
      const idx = this.order.indexOf(id);
      const pressed = idx > -1 && idx < this.progress;
      const key = document.createElement("button");
      key.className = `key${pressed ? " is-lit" : ""}`;
      key.disabled = pressed || this.status === "solved" || !this.ctx.missionLive();
      key.dataset.glyph = id;
      key.setAttribute("aria-label", `key showing ${g.name} symbol`);
      key.innerHTML = `<span class="key-glyph">${g.char}</span><span class="key-name">${g.name}</span><span class="key-led"></span>`;
      key.addEventListener("click", () => this.press(id));
      pad.appendChild(key);
    });
    root.appendChild(pad);
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.setAttribute("role", "status");
    hint.setAttribute("aria-live", "polite");
    hint.tabIndex = -1;
    hint.textContent =
      this.status === "solved"
        ? "Sequence accepted."
        : `${this.progress} of 4 accepted. Press all four keys in the correct order; a wrong key resets the sequence.`;
    root.appendChild(hint);
  }

  private press(id: string): void {
    if (!this.ctx.missionLive() || this.status === "solved") return;
    const pressedIndex = this.displayed.indexOf(id);
    sfx.click();
    this.ctx.humanAction();
    if (id === this.order[this.progress]) {
      this.progress++;
      this.flashWrong = false;
      if (this.progress === 4) {
        this.status = "solved";
        this.ctx.feed("Glyph sequence accepted — KEYPAD disarmed.", "good");
        this.ctx.solve();
      }
    } else {
      this.progress = 0;
      this.flashWrong = true;
      this.ctx.feed(`Key ${glyph(id).name} rejected — sequence reset.`, "bad");
      this.ctx.strike("wrong glyph key pressed");
    }
    this.ctx.update();
    if (!this.root?.isConnected) return;
    if (this.status === "solved") {
      this.root.querySelector<HTMLElement>('[role="status"]')?.focus({ preventScroll: true });
      return;
    }
    const keys = [...this.root.querySelectorAll<HTMLButtonElement>(".key")];
    const next = [...keys.slice(pressedIndex + 1), ...keys.slice(0, pressedIndex + 1)].find((key) => !key.disabled);
    next?.focus({ preventScroll: true });
  }
}
