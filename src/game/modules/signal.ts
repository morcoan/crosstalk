import { sfx } from "../../lib/audio";
import type { GameModule, ModuleCtx, ToolSpec } from "../types";

/**
 * SIGNAL TRANSMITTER — asymmetry: the device loops an audible beep pattern the
 * agent cannot hear (a speaker LED pulses in sync for muted play), while the
 * frequency dial is SEIZED for human hands — only the agent's servo tool can
 * seat it. Human reports the rhythm; agent looks up the frequency and sets the
 * dial; human presses TRANSMIT.
 */

export interface SignalDetent {
  pattern: string; // e.g. "short short long"
  mhz: number;
}

/** Single source of truth for the pattern → frequency table (manual.ts renders it). */
export const SIGNAL_TABLE: SignalDetent[] = [
  { pattern: "short short short", mhz: 3.505 },
  { pattern: "short short long", mhz: 3.515 },
  { pattern: "short long short", mhz: 3.522 },
  { pattern: "short long long", mhz: 3.532 },
  { pattern: "long short short", mhz: 3.545 },
  { pattern: "long short long", mhz: 3.552 },
  { pattern: "long long short", mhz: 3.565 },
  { pattern: "long long long", mhz: 3.572 }
];

const SHORT_MS = 130;
const LONG_MS = 430;
const GAP_MS = 260;
const CYCLE_PAUSE_MS = 1600;

export class SignalModule implements GameModule {
  readonly kind = "signal" as const;
  readonly label = "SIGNAL TX";
  status: "armed" | "solved" = "armed";

  private target: SignalDetent;
  private txMhz: number | null = null;
  private cycleT = 0;
  private events: { start: number; dur: number }[] = [];
  private cycleLen = 0;
  private ledEl: HTMLElement | null = null;
  private txEl: HTMLElement | null = null;
  private beeped = new Set<number>();
  private root: HTMLElement | null = null;

  constructor(private ctx: ModuleCtx) {
    this.target = ctx.rng.pick(SIGNAL_TABLE);
    let t = 400;
    for (const word of this.target.pattern.split(" ")) {
      const dur = word === "long" ? LONG_MS : SHORT_MS;
      this.events.push({ start: t, dur });
      t += dur + GAP_MS;
    }
    this.cycleLen = t + CYCLE_PAUSE_MS;
  }

  agentSummary(): string {
    return (
      `Loops an audible beep pattern — you CANNOT hear it; ask your partner for the rhythm ` +
      `(e.g. "short long short"). The frequency dial is seized: only your set_transmitter_frequency ` +
      `tool can seat it${this.txMhz ? ` (currently seated at ${this.txMhz.toFixed(3)} MHz)` : " (currently unseated)"}. ` +
      `Table: manual section "signal". The TRANSMIT key is manual-only.`
    );
  }

  tools(): ToolSpec[] {
    return [
      {
        name: "set_transmitter_frequency",
        title: "Seat transmitter frequency dial",
        description:
          "Servo-seat the transmitter's frequency dial in MHz (the physical dial is seized — your partner " +
          "cannot turn it). The dial only seats at fixed detents between 3.500 and 3.580 MHz; the beep-pattern " +
          "→ frequency table is in manual section \"signal\". Ask your partner for the looping beep rhythm " +
          "(shorts and longs) first — the speaker is not machine-readable. After seating, the human presses TRANSMIT.",
        inputSchema: {
          type: "object",
          properties: {
            mhz: {
              type: "number",
              description: "Target frequency in MHz, e.g. 3.522. Must match a detent from the manual table."
            }
          },
          required: ["mhz"]
        },
        execute: (input) => this.setFrequency(Number(input.mhz))
      }
    ];
  }

  private setFrequency(mhz: number): string {
    if (!this.ctx.missionLive()) throw new Error("This transmitter control belongs to an expired device session.");
    if (this.status === "solved") return "The transmitter already fired. Module is disarmed.";
    if (!Number.isFinite(mhz)) throw new Error("mhz must be a number, e.g. 3.522");
    const detent = SIGNAL_TABLE.find((d) => Math.abs(d.mhz - mhz) < 0.0005);
    if (!detent) {
      throw new Error(
        `The dial refuses to seat at ${mhz} MHz — that is not a detent. Valid detents are listed in ` +
        `manual section "signal" (3.500–3.580 MHz range). No strike; the dial simply won't seat.`
      );
    }
    this.txMhz = detent.mhz;
    sfx.servo();
    this.ctx.feed(`Servo seated the TX dial at ${detent.mhz.toFixed(3)} MHz.`, "tool");
    this.ctx.update();
    return (
      `Dial seated at ${detent.mhz.toFixed(3)} MHz. Confirm the rhythm with your partner, ` +
      `then have them press TRANSMIT.`
    );
  }

  tick(dt: number): void {
    if (this.status === "solved" || !this.ctx.missionLive()) return;
    this.cycleT = (this.cycleT + dt) % this.cycleLen;
    let led = false;
    this.events.forEach((ev, i) => {
      const within = this.cycleT >= ev.start && this.cycleT < ev.start + ev.dur;
      if (within) {
        led = true;
        if (!this.beeped.has(i)) {
          this.beeped.add(i);
          sfx.beep(ev.dur > 200);
        }
      }
    });
    if (this.cycleT < this.events[0].start) this.beeped.clear();
    this.ledEl?.classList.toggle("is-on", led);
  }

  render(root: HTMLElement): void {
    this.root = root;
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "signal";
    wrap.innerHTML = `
      <div class="signal-row">
        <div class="speaker" aria-label="speaker">
          <span class="speaker-led" data-role="led"></span>
          <span class="speaker-grill">${"<i></i>".repeat(6)}</span>
        </div>
        <div class="signal-dial">
          <div class="dial-label">FREQ DIAL <span class="seized">SEIZED — SERVO ONLY</span></div>
          <div class="dial-value" data-role="tx">${this.txMhz ? this.txMhz.toFixed(3) + " MHz" : "— UNSEATED —"}</div>
        </div>
      </div>`;
    const btn = document.createElement("button");
    btn.className = "btn btn-transmit";
    btn.textContent = this.status === "solved" ? "TRANSMITTED ✓" : "TRANSMIT";
    btn.disabled = this.status === "solved" || !this.ctx.missionLive();
    btn.addEventListener("click", () => this.transmit());
    wrap.appendChild(btn);
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent =
      this.status === "solved"
        ? "Handshake accepted."
        : "Listen to the beep loop (LED pulses with it). Your agent must seat the dial before you transmit.";
    wrap.appendChild(hint);
    root.appendChild(wrap);
    this.ledEl = wrap.querySelector('[data-role="led"]');
    this.txEl = wrap.querySelector('[data-role="tx"]');
    void this.txEl;
  }

  private transmit(): void {
    if (!this.ctx.missionLive() || this.status === "solved") return;
    sfx.click();
    this.ctx.humanAction(this.txMhz !== null);
    if (this.txMhz === null) {
      this.ctx.feed("TRANSMIT pressed with no frequency seated — transmitter idle.", "info");
      this.ctx.update();
      this.root?.querySelector<HTMLButtonElement>(".btn-transmit")?.focus({ preventScroll: true });
      return;
    }
    if (Math.abs(this.txMhz - this.target.mhz) < 0.0005) {
      this.status = "solved";
      this.ctx.feed(`Transmission on ${this.txMhz.toFixed(3)} MHz accepted — SIGNAL TX disarmed.`, "good");
      this.ctx.solve();
    } else {
      this.ctx.feed(`Transmission on ${this.txMhz.toFixed(3)} MHz REJECTED — checksum mismatch.`, "bad");
      this.ctx.strike("transmitted on the wrong frequency");
    }
    this.ctx.update();
    if (this.root?.isConnected && this.status !== "solved") {
      this.root.querySelector<HTMLButtonElement>(".btn-transmit")?.focus({ preventScroll: true });
    }
  }
}
