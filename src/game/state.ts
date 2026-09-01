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
import { saveCompletedSessionWithStatus } from "./training";
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
  /** Monotonically increasing owner token; module/tool callbacks may only affect this session. */
  sessionId: number;
  mission: MissionDef;
  seed: number;
  serial: string;
  modules: GameModule[];
  msLeft: number;
  strikes: number;
  result: MissionResult;
  startedAt: number;
  /** Absolute wall-clock deadline. msLeft is a monotonic cached projection of it. */
  deadlineAt: number;
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
let sessionSequence = 0;
let detonationHandle: number | null = null;

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function feed(text: string, tone: FeedTone = "info"): void {
  const clock = game.device?.revealed ? fmtClock(game.device.msLeft) : "--:--";
  game.feed.push({ at: Date.now(), clock, text, tone });
  if (game.feed.length > 200) game.feed.shift();
  emit("feed");
}

export function missionLive(): boolean {
  return game.device ? deviceLive(game.device) : false;
}

export function detonationTransitionPending(): boolean {
  return game.screen === "active" && game.device?.result === "detonated";
}

function ownsCurrentSession(d: DeviceState): boolean {
  return game.device === d && game.device.sessionId === d.sessionId;
}

function updateRemaining(d: DeviceState, now = Date.now()): number {
  if (d.result !== null) return d.msLeft;
  const fromDeadline = Math.max(0, d.deadlineAt - now);
  // Never allow a backward system-clock correction to add time to the fuse.
  d.msLeft = Math.min(d.msTotal, d.msLeft, fromDeadline);
  return d.msLeft;
}

/** Reconcile the current fuse against real wall time; overdue sessions detonate before an action can land. */
export function syncMissionClock(now = Date.now()): number | null {
  const d = game.device;
  if (!d) return null;
  updateRemaining(d, now);
  if (d.result === null && d.revealed && d.msLeft <= 0) detonate("timer reached zero", d);
  return d.msLeft;
}

function deviceLive(d: DeviceState): boolean {
  if (!ownsCurrentSession(d) || !d.revealed || d.result !== null) return false;
  updateRemaining(d);
  if (d.msLeft <= 0) {
    detonate("timer reached zero", d);
    return false;
  }
  return true;
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
  if (detonationTransitionPending()) {
    throw new Error("The device is still in its detonation sequence. Wait for the debrief before loading another mission.");
  }
  game.briefingMission = mission;
  game.screen = "briefing";
  emit("screen");
  return mission;
}

/** Build the device and reveal it — the timer starts here. */
export function armDevice(mission: MissionDef): void {
  if (detonationTransitionPending()) {
    throw new Error("Cannot arm a new device while the previous detonation sequence is still resolving.");
  }
  clearDetonationTransition();
  const seed = randomSeed();
  const rng = makeRng(seed);
  const serial = makeSerial(rng);
  const startedAt = Date.now();
  const msTotal = mission.seconds * 1000;

  const device: DeviceState = {
    sessionId: ++sessionSequence,
    mission,
    seed,
    serial,
    modules: [],
    msLeft: msTotal,
    msTotal,
    strikes: 0,
    result: null,
    startedAt,
    deadlineAt: startedAt + msTotal,
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

  dirtyModules.clear();
  device.modules = mission.modules.map((kind) => {
    const slot: { mod: GameModule | null } = { mod: null };
    const ctx: ModuleCtx = {
      rng,
      serial,
      strike: (reason) => registerStrike(device, reason),
      solve: () => {
        if (!deviceLive(device)) return;
        if (slot.mod) dirtyModules.add(slot.mod);
        emit("lifecycle"); // solved module's tools get aborted
        checkWin(device);
        sfx.solve();
      },
      update: () => {
        if (!ownsCurrentSession(device)) return;
        if (slot.mod) dirtyModules.add(slot.mod);
        emit("state");
      },
      missionLive: () => deviceLive(device),
      feed: (text, tone) => {
        if (deviceLive(device)) feed(text, tone);
      },
      humanAction: (irreversible = false) => {
        if (!deviceLive(device)) return;
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
  sfx.arm();
}

function registerStrike(d: DeviceState, reason: string): void {
  if (!deviceLive(d)) return;
  d.strikes++;
  feed(`STRIKE ${d.strikes}/3 — ${reason}.`, "bad");
  if (d.strikes >= 3) {
    detonate("three strikes", d);
  } else {
    emit("state");
  }
  sfx.strike();
}

function checkWin(d: DeviceState): void {
  if (!deviceLive(d)) return;
  if (d.modules.every((m) => m.status === "solved")) {
    d.result = "disarmed";
    stopLoop();
    feed(`ALL MODULES DISARMED with ${fmtClock(d.msLeft)} remaining. Device released.`, "good");
    game.screen = "debrief";
    const bestSaved = saveBest(d);
    const dossierSaved = saveTraining(d);
    if (!bestSaved || !dossierSaved) {
      feed("LOCAL RECORD NOT SAVED — browser storage is unavailable or full. Gameplay is unaffected.", "bad");
    }
    emit("screen");
    emit("lifecycle");
    sfx.win();
  }
}

function detonate(cause: string, d: DeviceState): void {
  if (!ownsCurrentSession(d) || d.result) return;
  d.msLeft = Math.max(0, d.msLeft);
  d.result = "detonated";
  stopLoop();
  feed(`DEVICE DETONATED — ${cause}.`, "bad");
  if (!saveTraining(d)) {
    feed("LOCAL RECORD NOT SAVED — browser storage is unavailable or full. Gameplay is unaffected.", "bad");
  }
  setBoomClass(true);
  const sessionId = d.sessionId;
  detonationHandle = globalThis.setTimeout(() => {
    detonationHandle = null;
    setBoomClass(false);
    if (!ownsCurrentSession(d) || d.sessionId !== sessionId || d.result !== "detonated" || game.screen !== "active") {
      return;
    }
    game.screen = "debrief";
    emit("screen");
  }, 1400);
  emit("state");
  emit("lifecycle");
  sfx.boom();
}

function saveTraining(d: DeviceState): boolean {
  if (d.dossierSaved) return true;
  if (!d.result) return false;
  const saved = saveCompletedSessionWithStatus({
    missionId: d.mission.id,
    result: d.result,
    msLeft: d.msLeft,
    strikes: d.strikes,
    rating: rating(d),
    telemetry: d.telemetry,
    completedAt: Date.now()
  });
  d.dossierSaved = saved.persisted;
  return saved.persisted;
}

function startLoop(): void {
  stopLoop();
  const owner = game.device;
  if (!owner || typeof requestAnimationFrame !== "function") return;
  lastTick = Date.now();
  lastWholeSecond = -1;
  const step = (): void => {
    if (!ownsCurrentSession(owner) || owner.result !== null) return;
    const now = Date.now();
    const elapsed = Math.max(0, now - lastTick);
    lastTick = now;
    updateRemaining(owner, now);
    if (owner.msLeft <= 0) {
      detonate("timer reached zero", owner);
      return;
    }
    // Visual/audio modules remain bounded even if a background tab resumes late;
    // the authoritative fuse above always consumes the full wall-clock interval.
    const simulationDt = Math.min(200, elapsed);
    owner.modules.forEach((m) => m.tick?.(simulationDt));

    const sec = Math.ceil(owner.msLeft / 1000);
    if (sec !== lastWholeSecond) {
      lastWholeSecond = sec;
      if (sec <= 30 && sec > 0) sfx.timerTick();
      emit("state");
    }
    tickHandle = requestAnimationFrame(step);
  };
  tickHandle = requestAnimationFrame(step);
}

function stopLoop(): void {
  if (tickHandle !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(tickHandle);
  tickHandle = null;
}

function setBoomClass(active: boolean): void {
  if (typeof document === "undefined") return;
  document.body?.classList.toggle("is-boom", active);
}

function clearDetonationTransition(): void {
  if (detonationHandle !== null) globalThis.clearTimeout(detonationHandle);
  detonationHandle = null;
  setBoomClass(false);
}

export function backToMenu(): void {
  stopLoop();
  clearDetonationTransition();
  dirtyModules.clear();
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

export function parseBestRecord(raw: string | null, maxMs = Number.MAX_SAFE_INTEGER): BestRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Partial<BestRecord>;
    const { msLeft, strikes, when } = row;
    if (typeof msLeft !== "number" || !Number.isSafeInteger(msLeft) || msLeft < 0 || msLeft > maxMs) {
      return null;
    }
    if (typeof strikes !== "number" || !Number.isInteger(strikes) || strikes < 0 || strikes > 2) return null;
    if (typeof when !== "number" || !Number.isSafeInteger(when) || when < 0) return null;
    return { msLeft, strikes, when };
  } catch {
    return null;
  }
}

export function bestFor(missionId: string): BestRecord | null {
  const maxMs = (MISSIONS.find((mission) => mission.id === missionId)?.seconds ?? 86_400) * 1000;
  return parseBestRecord(store.get(`crosstalk.best.${missionId}`), maxMs);
}

function saveBest(d: DeviceState): boolean {
  const prev = bestFor(d.mission.id);
  if (!prev || d.msLeft > prev.msLeft) {
    return store.set(
      `crosstalk.best.${d.mission.id}`,
      JSON.stringify({ msLeft: d.msLeft, strikes: d.strikes, when: Date.now() } satisfies BestRecord)
    );
  }
  return true;
}

export function rating(d: DeviceState): string {
  if (d.result !== "disarmed") return "—";
  const frac = d.msLeft / d.msTotal;
  if (d.strikes === 0 && frac >= 0.5) return "S — FLAWLESS CROSSTALK";
  if (d.strikes === 0) return "A — CLEAN HANDS";
  if (d.strikes === 1) return "B — SINGED";
  return "C — SMOKING";
}
