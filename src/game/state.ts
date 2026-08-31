import { emit } from "../lib/bus";
import { store } from "../lib/dom";
import { sfx } from "../lib/audio";
import { makeRng, randomSeed, type Rng } from "../lib/rng";
import type {
  FeedEntry,
  FeedTone,
  GameModule,
  MissionDef,
  MissionResult,
  ModuleCtx,
  Screen,
  SessionTelemetry
} from "./types";
import { saveCompletedSession } from "./training";
import { EchoModule } from "./modules/echo";
import { KeypadModule } from "./modules/keypad";
import { RegulatorModule } from "./modules/regulator";
import { SignalModule } from "./modules/signal";
import { WiresModule } from "./modules/wires";

export const MISSIONS: MissionDef[] = [
  {
    id: "handshake",
    codename: "HANDSHAKE",
    tagline: "Training device · 1 module",
    seconds: 300,
    modules: ["wires"],
    brief:
      "A training device with a single WIRE BAY. You can see the wire colors; your agent holds the " +
      "cutting rules and the RFID serial scanner. Read the wires aloud, top to bottom, and cut only " +
      "what your agent calls."
  },
  {
    id: "crossed-wires",
    codename: "CROSSED WIRES",
    tagline: "Field device · 3 modules",
    seconds: 480,
    modules: ["wires", "keypad", "regulator"],
    brief:
      "Three modules. The REGULATOR flips the script: only your agent can move its dial, but only you " +
      "can read the gauge. Keep talking — needle readings in, servo nudges out."
  },
  {
    id: "silent-frequency",
    codename: "SILENT FREQUENCY",
    tagline: "Hostile device · 4 modules",
    seconds: 600,
    modules: ["keypad", "echo", "signal", "wires"],
    brief:
      "Four modules, including an ECHO CORE that punishes forgetfulness and a SIGNAL TX that only you " +
      "can hear and only your agent can tune. This is the full crosstalk experience."
  }
];

export interface DeviceState {
  mission: MissionDef;
  seed: number;
  serial: string;
  modules: GameModule[];
  msLeft: number;
  strikes: number;
  result: MissionResult;
  startedAt: number;
  msTotal: number;
  toolCalls: number;
  telemetry: SessionTelemetry;
  dossierSaved: boolean;
  revealed: boolean; // briefing done, device visible, timer running
}

interface GameState {
  screen: Screen;
  device: DeviceState | null;
  feed: FeedEntry[];
  briefingMission: MissionDef | null;
}

export const game: GameState = {
  screen: "menu",
  device: null,
  feed: [],
  briefingMission: null
};

/** Modules whose body needs a re-render (UI reads + clears this). */
export const dirtyModules = new Set<GameModule>();

let tickHandle: number | null = null;
let lastTick = 0;
let lastWholeSecond = -1;

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function feed(text: string, tone: FeedTone = "info"): void {
  const clock = game.device && game.device.revealed && !game.device.result ? fmtClock(game.device.msLeft) : "--:--";
  game.feed.push({ at: Date.now(), clock, text, tone });
  if (game.feed.length > 200) game.feed.shift();
  emit("feed");
}

export function missionLive(): boolean {
  return !!game.device && game.device.revealed && game.device.result === null;
}

function makeSerial(rng: Rng): string {
  const letters = "ABCDEFGHJKLMNPRSTUVWXZ";
  const l = () => letters[rng.int(0, letters.length - 1)];
  const d = () => String(rng.int(0, 9));
  return `${l()}${l()}${l()}-${d()}${d()}${d()}${d()}`;
}

function buildModule(kind: MissionDef["modules"][number], ctx: ModuleCtx, missionId: string): GameModule {
  switch (kind) {
    case "wires": {
      const count = missionId === "handshake" ? 3 : missionId === "crossed-wires" ? 4 : 5;
      return new WiresModule(ctx, count as 3 | 4 | 5);
    }
    case "keypad":
      return new KeypadModule(ctx);
    case "regulator":
      return new RegulatorModule(ctx);
    case "echo":
      return new EchoModule(ctx);
    case "signal":
      return new SignalModule(ctx);
  }
}

export function goToBriefing(missionId: string): MissionDef {
  const mission = MISSIONS.find((m) => m.id === missionId);
  if (!mission) {
    throw new Error(`Unknown mission "${missionId}". Valid ids: ${MISSIONS.map((m) => m.id).join(", ")}.`);
  }
  game.briefingMission = mission;
  game.screen = "briefing";
  emit("screen");
  return mission;
}

/** Build the device and reveal it — the timer starts here. */
export function armDevice(mission: MissionDef): void {
  sfx.arm();
  const seed = randomSeed();
  const rng = makeRng(seed);
  const serial = makeSerial(rng);

  const device: DeviceState = {
    mission,
    seed,
    serial,
    modules: [],
    msLeft: mission.seconds * 1000,
    msTotal: mission.seconds * 1000,
    strikes: 0,
    result: null,
    startedAt: Date.now(),
    toolCalls: 0,
    telemetry: {
      agentReads: 0,
      agentActuations: 0,
      toolErrors: 0,
      humanActions: 0,
      irreversibleConfirmations: 0,
      toolUsage: {}
    },
    dossierSaved: false,
    revealed: true
  };

  device.modules = mission.modules.map((kind) => {
    const slot: { mod: GameModule | null } = { mod: null };
    const ctx: ModuleCtx = {
      rng,
      serial,
      strike: (reason) => registerStrike(reason),
      solve: () => {
        sfx.solve();
        if (slot.mod) dirtyModules.add(slot.mod);
        emit("lifecycle"); // solved module's tools get aborted
        checkWin();
      },
      update: () => {
        if (slot.mod) dirtyModules.add(slot.mod);
        emit("state");
      },
      missionLive,
      feed,
      humanAction: (irreversible = false) => {
        device.telemetry.humanActions++;
        if (irreversible) device.telemetry.irreversibleConfirmations++;
      }
    };
    const mod = buildModule(kind, ctx, mission.id);
    slot.mod = mod;
    dirtyModules.add(mod);
    return mod;
  });
  game.device = device;
  game.screen = "active";
  game.feed = [];
  feed(`Device ${serial} armed — ${mission.codename}. ${fmtClock(device.msLeft)} on the clock.`, "system");
  emit("screen");
  emit("lifecycle");
  startLoop();
}

function registerStrike(reason: string): void {
  const d = game.device;
  if (!d || d.result) return;
  d.strikes++;
  sfx.strike();
  feed(`STRIKE ${d.strikes}/3 — ${reason}.`, "bad");
  if (d.strikes >= 3) {
    detonate("three strikes");
  }
  emit("state");
}

function checkWin(): void {
  const d = game.device;
  if (!d || d.result) return;
  if (d.modules.every((m) => m.status === "solved")) {
    d.result = "disarmed";
    stopLoop();
    sfx.win();
    feed(`ALL MODULES DISARMED with ${fmtClock(d.msLeft)} remaining. Device released.`, "good");
    game.screen = "debrief";
    saveBest(d);
    saveTraining(d);
    emit("screen");
    emit("lifecycle");
  }
}

function detonate(cause: string): void {
  const d = game.device;
  if (!d || d.result) return;
  d.result = "detonated";
  saveTraining(d);
  stopLoop();
  sfx.boom();
  feed(`DEVICE DETONATED — ${cause}.`, "bad");
  document.body.classList.add("is-boom");
  window.setTimeout(() => {
    document.body.classList.remove("is-boom");
    game.screen = "debrief";
    emit("screen");
  }, 1400);
  emit("state");
  emit("lifecycle");
}

function saveTraining(d: DeviceState): void {
  if (d.dossierSaved || !d.result) return;
  d.dossierSaved = true;
  saveCompletedSession({
    missionId: d.mission.id,
    result: d.result,
    msLeft: d.msLeft,
    strikes: d.strikes,
    rating: rating(d),
    telemetry: d.telemetry,
    completedAt: Date.now()
  });
}

function startLoop(): void {
  stopLoop();
  lastTick = performance.now();
  lastWholeSecond = -1;
  const step = (now: number): void => {
    const d = game.device;
    if (!d || d.result !== null) return;
    const dt = Math.min(200, now - lastTick);
    lastTick = now;
    d.msLeft -= dt;
    d.modules.forEach((m) => m.tick?.(dt));

    const sec = Math.ceil(d.msLeft / 1000);
    if (sec !== lastWholeSecond) {
      lastWholeSecond = sec;
      if (sec <= 30 && sec > 0) sfx.timerTick();
      emit("state");
    }
    if (d.msLeft <= 0) {
      d.msLeft = 0;
      detonate("timer reached zero");
      return;
    }
    tickHandle = requestAnimationFrame(step);
  };
  tickHandle = requestAnimationFrame(step);
}

function stopLoop(): void {
  if (tickHandle !== null) cancelAnimationFrame(tickHandle);
  tickHandle = null;
}

export function backToMenu(): void {
  stopLoop();
  game.device = null;
  game.briefingMission = null;
  game.screen = "menu";
  emit("screen");
  emit("lifecycle");
}

/* ---------------- best times ---------------- */

export interface BestRecord {
  msLeft: number;
  strikes: number;
  when: number;
}

export function bestFor(missionId: string): BestRecord | null {
  try {
    const raw = store.get(`crosstalk.best.${missionId}`);
    return raw ? (JSON.parse(raw) as BestRecord) : null;
  } catch {
    return null;
  }
}

function saveBest(d: DeviceState): void {
  const prev = bestFor(d.mission.id);
  if (!prev || d.msLeft > prev.msLeft) {
    store.set(
      `crosstalk.best.${d.mission.id}`,
      JSON.stringify({ msLeft: d.msLeft, strikes: d.strikes, when: Date.now() } satisfies BestRecord)
    );
  }
}

export function rating(d: DeviceState): string {
  if (d.result !== "disarmed") return "—";
  const frac = d.msLeft / d.msTotal;
  if (d.strikes === 0 && frac >= 0.5) return "S — FLAWLESS CROSSTALK";
  if (d.strikes === 0) return "A — CLEAN HANDS";
  if (d.strikes === 1) return "B — SINGED";
  return "C — SMOKING";
}
