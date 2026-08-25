import type { GameModule, ModuleCtx, ToolSpec } from "../types";

/**
 * VOLTAGE REGULATOR — inverted asymmetry: only the AGENT can move the needle
 * (the trim dial sits behind the faceplate, reachable by servo tools), but the
 * gauge sensor is burned out on the agent's side — only the HUMAN can read the
 * needle and the green target zone. A closed loop of agent actuation and human
 * telemetry. Locking outside the zone is a strike.
 */
export class RegulatorModule implements GameModule {
  readonly kind = "regulator" as const;
  readonly label = "REGULATOR";
  status: "armed" | "solved" = "armed";

  private value: number;
  private zoneLo: number;
  private zoneHi: number;
  private drift: number;
  private driftTimer = 0;
  private nudges = 0;

  constructor(private ctx: ModuleCtx) {
    this.zoneLo = ctx.rng.int(18, 74);
    this.zoneHi = this.zoneLo + 8;
    // Start the needle at least 25 units away from the zone.
    const below = this.zoneLo - 25;
    const above = this.zoneHi + 25;
    const candidates: number[] = [];
    if (below >= 4) candidates.push(ctx.rng.int(4, below));
    if (above <= 96) candidates.push(ctx.rng.int(above, 96));
    this.value = ctx.rng.pick(candidates);
    // Slow creep: visible tension, but fair even at real chat latency (~10 units/min).
    this.drift = ctx.rng.chance(0.5) ? 0.15 : -0.15;
  }

  agentSummary(): string {
    return (
      `Trim dial responds to your nudge_regulator tool (${this.nudges} nudges so far); lock_regulator seals it. ` +
      `The gauge sensor is BURNED OUT on your side — only your partner can read the needle and the green zone. ` +
      `Ask for readings between nudges. Locking outside the zone causes a strike.`
    );
  }

  tools(): ToolSpec[] {
    return [
      {
        name: "nudge_regulator",
        title: "Nudge regulator trim dial",
        description:
          "Actuate the regulator's servo trim dial to move the voltage needle. The gauge is not " +
          "machine-readable: after nudging, ask your human partner for the new needle reading and " +
          "where the green target zone sits (the gauge runs 0-100). 'coarse' moves roughly 9-13 " +
          "units, 'fine' roughly 2-4 units.",
        inputSchema: {
          type: "object",
          properties: {
            direction: { type: "string", enum: ["up", "down"], description: "Increase or decrease voltage." },
            magnitude: { type: "string", enum: ["coarse", "fine"], description: "Roughly 9-13 units (coarse) or 2-4 units (fine)." }
          },
          required: ["direction", "magnitude"]
        },
        execute: (input) => this.nudge(String(input.direction), String(input.magnitude))
      },
      {
        name: "lock_regulator",
        title: "Lock regulator",
        description:
          "Permanently lock the regulator at the current needle position. Only do this after your " +
          "partner confirms the needle is inside the green zone — locking outside it causes a strike.",
        inputSchema: { type: "object", properties: {} },
        execute: () => this.lock()
      }
    ];
  }

  private nudge(direction: string, magnitude: string): string {
    if (this.status === "solved") return "The regulator is already locked.";
    if (direction !== "up" && direction !== "down") throw new Error('direction must be "up" or "down".');
    if (magnitude !== "coarse" && magnitude !== "fine") throw new Error('magnitude must be "coarse" or "fine".');
    const step = magnitude === "coarse" ? this.ctx.rng.int(9, 13) : this.ctx.rng.int(2, 4);
    this.value = clamp(this.value + (direction === "up" ? step : -step), 1, 99);
    this.nudges++;
    this.ctx.feed(`Servo nudged the trim dial ${direction === "up" ? "▲" : "▼"} (${magnitude}).`, "tool");
    this.ctx.update();
    return (
      `Servo fired ${direction} (${magnitude}). Gauge feedback is unavailable on your side — ` +
      `ask your partner for the current needle reading before nudging again or locking.`
    );
  }

  private lock(): string {
    if (this.status === "solved") return "The regulator is already locked.";
    const inside = this.value >= this.zoneLo && this.value <= this.zoneHi;
    if (inside) {
      this.status = "solved";
      this.ctx.feed("Regulator locked inside the green zone — REGULATOR disarmed.", "good");
      this.ctx.solve();
      this.ctx.update();
      return "LOCKED. The needle was inside the green zone. Module disarmed. Well done.";
    }
    this.ctx.feed("Regulator mis-locked outside the green zone!", "bad");
    this.ctx.strike("regulator locked outside the target zone");
    this.ctx.update();
    return (
      "MIS-LOCK! The needle was OUTSIDE the green zone; the lock disengaged and the device " +
      "registered a strike. Ask your partner for the needle reading and the zone bounds, then try again."
    );
  }

  tick(dt: number): void {
    if (this.status === "solved" || !this.ctx.missionLive()) return;
    this.driftTimer += dt;
    if (this.driftTimer >= 900) {
      this.driftTimer = 0;
      if (this.ctx.rng.chance(0.15)) this.drift = -this.drift;
      this.value = clamp(this.value + this.drift, 1, 99);
      this.ctx.update();
    }
  }

  render(root: HTMLElement): void {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "gauge-wrap";
    wrap.innerHTML = gaugeSvg(this.value, this.zoneLo, this.zoneHi, this.status === "solved");
    const readout = document.createElement("div");
    readout.className = "gauge-readout";
    readout.innerHTML =
      this.status === "solved"
        ? `<span class="ok">LOCKED @ ${Math.round(this.value)}</span>`
        : `NEEDLE <b>${Math.round(this.value)}</b> · GREEN ZONE <b>${this.zoneLo}–${this.zoneHi}</b>` +
          `<div class="hint">Dial is servo-only — your agent moves it; you read the gauge aloud.</div>`;
    wrap.appendChild(readout);
    root.appendChild(wrap);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Draws a 0-100 arc gauge with a green target band and a needle. */
function gaugeSvg(value: number, lo: number, hi: number, locked: boolean): string {
  const a0 = -120;
  const a1 = 120;
  const angle = (v: number) => a0 + ((a1 - a0) * v) / 100;
  const polar = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)];
  };
  const arc = (from: number, to: number, r: number) => {
    const [x0, y0] = polar(angle(from), r);
    const [x1, y1] = polar(angle(to), r);
    const large = Math.abs(angle(to) - angle(from)) > 180 ? 1 : 0;
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  let ticks = "";
  for (let v = 0; v <= 100; v += 10) {
    const [x0, y0] = polar(angle(v), 78);
    const [x1, y1] = polar(angle(v), 88);
    const [tx, ty] = polar(angle(v), 65);
    ticks += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" class="gauge-tick"/>`;
    ticks += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" class="gauge-label">${v}</text>`;
  }
  const [nx, ny] = polar(angle(value), 72);
  return `
  <svg viewBox="14 20 172 122" class="gauge" role="img" aria-label="voltage gauge, needle at ${Math.round(value)}, green zone ${lo} to ${hi}">
    <path d="${arc(0, 100, 88)}" class="gauge-arc"/>
    <path d="${arc(lo, hi, 88)}" class="gauge-zone"/>
    ${ticks}
    <line x1="100" y1="100" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" class="gauge-needle${locked ? " is-locked" : ""}"/>
    <circle cx="100" cy="100" r="5" class="gauge-hub"/>
  </svg>`;
}
