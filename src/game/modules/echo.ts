import type { GameModule, ModuleCtx, ToolSpec } from "../types";

/**
 * ECHO MEMORY CORE — asymmetry: the display digit and shuffled button labels are
 * human-visible only, but the rules chain backwards through earlier stages
 * ("press the same LABEL as stage 2"). Humans forget; agents don't. The agent
 * also gets a read-only flight recorder (get_echo_log) so it never has to trust
 * its own conversation memory.
 */

export type EchoRule =
  | { type: "position"; value: number }
  | { type: "label"; value: number }
  | { type: "samePosition"; stage: number }
  | { type: "sameLabel"; stage: number };

/** RULES[stage-1][display-1] — single source of truth; manual.ts renders it verbatim. */
export const ECHO_RULES: EchoRule[][] = [
  [
    { type: "position", value: 2 },
    { type: "position", value: 3 },
    { type: "label", value: 1 },
    { type: "label", value: 4 }
  ],
  [
    { type: "label", value: 4 },
    { type: "samePosition", stage: 1 },
    { type: "position", value: 1 },
    { type: "sameLabel", stage: 1 }
  ],
  [
    { type: "sameLabel", stage: 2 },
    { type: "sameLabel", stage: 1 },
    { type: "position", value: 3 },
    { type: "label", value: 2 }
  ],
  [
    { type: "samePosition", stage: 2 },
    { type: "sameLabel", stage: 1 },
    { type: "samePosition", stage: 3 },
    { type: "sameLabel", stage: 2 }
  ]
];

export function ruleText(rule: EchoRule): string {
  switch (rule.type) {
    case "position":
      return `press the button in POSITION ${rule.value}`;
    case "label":
      return `press the button LABELED ${rule.value}`;
    case "samePosition":
      return `press the button in the SAME POSITION you pressed in stage ${rule.stage}`;
    case "sameLabel":
      return `press the button with the SAME LABEL you pressed in stage ${rule.stage}`;
  }
}

interface EchoPress {
  stage: number;
  display: number;
  position: number;
  label: number;
}

export class EchoModule implements GameModule {
  readonly kind = "echo" as const;
  readonly label = "ECHO CORE";
  status: "armed" | "solved" = "armed";

  private stage = 1; // 1..4
  private display = 1;
  private labels: number[] = [1, 2, 3, 4];
  private history: EchoPress[] = [];

  constructor(private ctx: ModuleCtx) {
    this.rollStage();
  }

  private rollStage(): void {
    this.display = this.ctx.rng.int(1, 4);
    this.labels = this.ctx.rng.shuffle([1, 2, 3, 4]);
  }

  /** Resolve the correct button position for the current stage. */
  private correctPosition(): number {
    const rule = ECHO_RULES[this.stage - 1][this.display - 1];
    switch (rule.type) {
      case "position":
        return rule.value;
      case "label":
        return this.labels.indexOf(rule.value) + 1;
      case "samePosition":
        return this.history[rule.stage - 1].position;
      case "sameLabel":
        return this.labels.indexOf(this.history[rule.stage - 1].label) + 1;
    }
  }

  agentSummary(): string {
    return (
      `Sequential memory core, stage ${this.stage}/4. The display digit and shuffled button labels ` +
      `are on-screen only — ask your partner for the CURRENT display and the four labels left to right. ` +
      `Past presses are in your get_echo_log tool. Rules: manual section "echo".`
    );
  }

  tools(): ToolSpec[] {
    return [
      {
        name: "get_echo_log",
        title: "Read ECHO flight recorder",
        description:
          "Read-only flight recorder for the ECHO CORE: for each completed stage it returns the display " +
          "digit, plus the position and the label of the button that was pressed. Use it to resolve rules " +
          'like "press the same LABEL as stage 2" without relying on memory of the conversation.',
        inputSchema: { type: "object", properties: {} },
        readOnly: true,
        execute: () => {
          if (this.history.length === 0) {
            return `No stages completed yet. ECHO is on stage ${this.stage}; ask your partner for the display digit and the four button labels.`;
          }
          const lines = this.history.map(
            (h) =>
              `Stage ${h.stage}: display was ${h.display}; partner pressed POSITION ${h.position}, which was LABELED ${h.label}.`
          );
          return `${lines.join("\n")}\nNow on stage ${this.stage}/4.`;
        }
      }
    ];
  }

  render(root: HTMLElement): void {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "echo";
    const stages = [1, 2, 3, 4]
      .map((s) => `<span class="stage-led${s <= this.history.length ? " is-lit" : ""}${s === this.stage && this.status !== "solved" ? " is-current" : ""}"></span>`)
      .join("");
    wrap.innerHTML = `
      <div class="echo-top">
        <div class="echo-display" aria-label="echo display">${this.status === "solved" ? "✓" : this.display}</div>
        <div class="echo-stages">${stages}</div>
      </div>`;
    const row = document.createElement("div");
    row.className = "echo-buttons";
    this.labels.forEach((label, i) => {
      const b = document.createElement("button");
      b.className = "echo-btn";
      b.disabled = this.status === "solved" || !this.ctx.missionLive();
      b.textContent = String(label);
      b.setAttribute("aria-label", `echo button position ${i + 1} labeled ${label}`);
      b.addEventListener("click", () => this.press(i + 1));
      row.appendChild(b);
    });
    wrap.appendChild(row);
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent =
      this.status === "solved"
        ? "Memory chain complete."
        : `Stage ${this.stage} of 4 — wrong press resets the whole chain.`;
    wrap.appendChild(hint);
    root.appendChild(wrap);
  }

  private press(position: number): void {
    if (!this.ctx.missionLive() || this.status === "solved") return;
    const correct = this.correctPosition();
    if (position === correct) {
      this.history.push({
        stage: this.stage,
        display: this.display,
        position,
        label: this.labels[position - 1]
      });
      if (this.stage === 4) {
        this.status = "solved";
        this.ctx.feed("Echo chain complete — ECHO CORE disarmed.", "good");
        this.ctx.solve();
      } else {
        this.stage++;
        this.rollStage();
        this.ctx.feed(`Echo stage ${this.stage - 1} accepted.`, "good");
      }
    } else {
      this.ctx.feed("Echo rejected the press — chain reset to stage 1.", "bad");
      this.ctx.strike("wrong echo button");
      this.stage = 1;
      this.history = [];
      this.rollStage();
    }
    this.ctx.update();
  }
}
