import { on } from "../lib/bus";
import { manualSection, MANUAL_SECTIONS } from "../game/manual";
import {
  detonationTransitionPending,
  fmtClock,
  game,
  goToBriefing,
  MISSIONS,
  missionLive,
  rating
} from "../game/state";
import { loadTrainingRecord, recommendMission, trainingTotals } from "../game/training";
import type { ToolSpec } from "../game/types";
import { syncTools } from "./context";

/**
 * Tool orchestration. Three tiers, mirroring the game state exactly:
 *  - BASE tools: always live (briefing, manual, device state, training record, mission start).
 *  - MISSION tools: live only while a device is armed (the RFID scanner).
 *  - MODULE tools: owned by armed modules; they vanish the moment a module is
 *    solved (per-tool AbortControllers → the browser fires `toolchange`).
 */

const BASE_OWNER = "base";
const missionChoices = () => MISSIONS.map(({ id, codename }) => ({ id, codename }));

export function trainingRecordText(): string {
  const record = loadTrainingRecord();
  const choices = missionChoices();
  const totals = trainingTotals(record, choices);
  const recommended = recommendMission(record, choices);
  const rows = MISSIONS.map((mission) => {
    const stats = record.missions[mission.id];
    if (!stats?.attempts) return `- ${mission.codename}: unattempted`;
    const best = stats.wins
      ? `best grade ${stats.bestRating}; fastest clear ${fmtClock(stats.bestMsLeft)} left`
      : "no disarm yet";
    return `- ${mission.codename}: ${stats.attempts} attempt(s), ${stats.wins} disarm(s), ${stats.cleanWins} clean; ${best}`;
  });
  return `CROSSTALK — LOCAL OPERATOR DOSSIER
Progress: ${totals.completed}/${MISSIONS.length} missions cleared · ${totals.cleanWins} clean clear(s) · ${totals.attempts} completed run(s).
Practice signals: ${totals.agentReads} agent read(s), ${totals.agentActuations} actuation(s), ${totals.humanActions} human input(s), ${totals.irreversibleConfirmations} irreversible confirmation(s), ${totals.toolErrors} tool error(s).
${rows.join("\n")}
RECOMMENDED DRILL: ${recommended.codename}. Records are local to this browser and measure page events, not the conversation.`;
}

export function lastSessionReviewText(): string {
  const d = game.device;
  if (!d?.result || game.screen !== "debrief") {
    throw new Error("No completed session is on the debrief screen. Finish a mission, then review it.");
  }
  const t = d.telemetry;
  const record = loadTrainingRecord();
  const next = recommendMission(record, missionChoices());
  const usage = Object.entries(t.toolUsage)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `${name}×${count}`)
    .join(", ") || "none";
  let coaching = `Advance to ${next.codename}; keep the describe → look up → decide → confirm → act loop crisp.`;
  if (d.result === "detonated") coaching = `Repeat ${d.mission.codename}; recover one module at a time and re-check state after each action.`;
  else if (t.toolErrors > 0) coaching = `Repeat ${d.mission.codename}; verify tool state and parameters before retrying.`;
  else if (d.strikes > 0) coaching = `Repeat ${d.mission.codename}; state the rule and verify the human-only signal before committing.`;

  return `CROSSTALK — LAST SESSION REVIEW
Outcome: ${d.result.toUpperCase()} · ${d.mission.codename} · ${fmtClock(d.msLeft)} left · ${d.strikes}/3 strikes · ${rating(d)}.
Modules: ${d.modules.filter((module) => module.status === "solved").length}/${d.modules.length} solved.
Agent side: ${t.agentReads} read(s), ${t.agentActuations} actuation(s), ${t.toolErrors} tool error(s). Usage: ${usage}.
Human side: ${t.humanActions} physical input(s), including ${t.irreversibleConfirmations} confirmed irreversible action(s).
COACHING: ${coaching}
Evidence boundary: these are observable page/tool events only; CROSSTALK does not record or score the conversation.`;
}

const getBriefing: ToolSpec = {
  name: "get_briefing",
  title: "Get agent briefing",
  description:
    "START HERE. Explains CROSSTALK — a two-player cooperative defusal game where YOU (the agent) are " +
    "the expert with the manual and the servo tools, and the human is the eyes and hands at the device. " +
    "Returns your role, the etiquette that keeps the device intact, and the mission list.",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
  execute: () => {
    const missions = MISSIONS.map(
      (m) => `- id "${m.id}" — ${m.codename} (${m.tagline}, ${fmtClock(m.seconds * 1000)} fuse)`
    ).join("\n");
    return `CROSSTALK — AGENT BRIEFING
You and your human partner are a bomb-disposal team. A device with a countdown timer and
several modules is on the bench. You two share the work, but not the senses:

YOUR SIDE (the agent): the manual (consult_manual), local training record
(get_training_record), RFID scanner (scan_data_tag while armed), servo tools, and memory.
THEIR SIDE (the human): eyes and hands. Paint colors, glyphs, needles, displays and beeps
are not machine-readable, and only the human can cut wires, press keys and hit TRANSMIT.

ETIQUETTE:
1. Call get_training_record to choose a drill. Once armed, call get_device_state and consult_manual.
2. Never guess. If a rule needs something you cannot sense, ask your partner to read it aloud.
3. Before anything irreversible (cut/lock/transmit) state the rule and the exact action.
4. Be brief and imperative: "Cut wire 3." beats a paragraph.
5. Three strikes — or the timer at zero — detonates the device.

MISSIONS:
${missions}

To play: call start_mission with a mission id (or ask your partner to pick one on screen).
The human presses ARM DEVICE to start the clock. On debrief, call review_last_session. Keep it crisp.`;
  }
};

const getTrainingRecord: ToolSpec = {
  name: "get_training_record",
  title: "Get local operator dossier",
  description:
    "Read this browser's local CROSSTALK training record: attempts, clears, collaboration signals, " +
    "and the deterministic next-drill recommendation. It measures page events, never the conversation.",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
  execute: trainingRecordText
};

const reviewLastSession: ToolSpec = {
  name: "review_last_session",
  title: "Review completed session",
  description:
    "Review the mission currently shown on the debrief screen. Returns observable agent-tool and human-input " +
    "signals, one coaching focus, and the recommended next drill. Available only after a completed run.",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
  execute: lastSessionReviewText
};

const consultManual: ToolSpec = {
  name: "consult_manual",
  title: "Consult the technical manual",
  description:
    "Look up a section of the CROSSTALK technical manual — the defusal rules only you hold. " +
    'Sections: "index", "general", "wires", "keypad", "regulator", "echo", "signal". ' +
    "Consult the section for each armed module before instructing your partner.",
  inputSchema: {
    type: "object",
    properties: {
      section: {
        type: "string",
        enum: ["index", ...MANUAL_SECTIONS],
        description: "Manual section to read."
      }
    },
    required: ["section"]
  },
  readOnly: true,
  execute: (input) => manualSection(String(input.section))
};

const getDeviceState: ToolSpec = {
  name: "get_device_state",
  title: "Get device state",
  description:
    "Read the current state of the game and the armed device: mission, timer, strikes, and for every " +
    "module its status plus WHAT YOU CAN AND CANNOT SENSE. Anything marked not machine-readable must be " +
    "read aloud by your human partner. Call this often — it is your situational awareness.",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
  execute: () => {
    const d = game.device;
    if (game.screen === "menu" || !d) {
      return `SCREEN: MISSION SELECT. No device armed. Missions: ${MISSIONS.map((m) => `"${m.id}"`).join(
        ", "
      )}. Call start_mission or ask your partner to pick one.`;
    }
    if (game.screen === "briefing" || !d.revealed) {
      const m = game.briefingMission ?? d.mission;
      return `SCREEN: BRIEFING for ${m.codename}. The device is not yet revealed; the clock starts when your partner presses ARM DEVICE. Use the time: consult_manual for ${m.modules.join(", ")}.`;
    }
    const lines = d.modules.map((mod, i) => {
      const status = mod.status === "solved" ? "SOLVED ✔" : "ARMED";
      return `${i + 1}. ${mod.label} — ${status}. ${mod.status === "solved" ? "" : mod.agentSummary()}`.trim();
    });
    const header =
      d.result === "detonated"
        ? `DEVICE DETONATED (${d.mission.codename}).`
        : d.result === "disarmed"
          ? `DEVICE DISARMED (${d.mission.codename}) — ${rating(d)}.`
          : `ACTIVE DEVICE — ${d.mission.codename}. TIME LEFT ${fmtClock(d.msLeft)} · STRIKES ${d.strikes}/3.`;
    return `${header}
MODULES:
${lines.join("\n")}
SERIAL TAG: machine-readable via scan_data_tag (you only).${
      d.result ? "\nCall start_mission to run another device." : ""
    }`;
  }
};

const startMission: ToolSpec = {
  name: "start_mission",
  title: "Start a mission",
  description:
    'Open the briefing for a mission: "handshake" (training, 1 module), "crossed-wires" (3 modules), ' +
    '"silent-frequency" (4 modules). The human partner must press ARM DEVICE on screen to reveal the ' +
    "device and start the clock — brief them while they do. Fails if a device is already live.",
  inputSchema: {
    type: "object",
    properties: {
      mission_id: {
        type: "string",
        enum: MISSIONS.map((m) => m.id),
        description: "Mission to load."
      }
    },
    required: ["mission_id"]
  },
  execute: (input) => {
    if (missionLive()) {
      throw new Error("A device is already live. Finish it (or let it end) before starting another mission.");
    }
    if (detonationTransitionPending()) {
      throw new Error("The device is still detonating. Wait for the debrief before starting another mission.");
    }
    const m = goToBriefing(String(input.mission_id));
    return (
      `Briefing for ${m.codename} is on your partner's screen (${m.modules.length} module(s): ` +
      `${m.modules.join(", ")}; fuse ${fmtClock(m.seconds * 1000)}). While they read it, consult the manual ` +
      `sections for those modules. The clock starts when they press ARM DEVICE.`
    );
  }
};

const scanDataTag: ToolSpec = {
  name: "scan_data_tag",
  title: "Scan RFID data tag",
  description:
    "Scan the device's RFID data tag — machine-readable only; to your partner it is a smudge of " +
    "microprint. Returns the serial number. Several wire rules depend on whether the serial's LAST " +
    "DIGIT is odd or even.",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
  execute: () => {
    const d = game.device;
    if (!d) throw new Error("No device on the bench — nothing to scan.");
    const lastDigit = Number(d.serial[d.serial.length - 1]);
    return `RFID DATA TAG
SERIAL: ${d.serial}  (last digit ${lastDigit} — ${lastDigit % 2 === 1 ? "ODD" : "EVEN"})
MFR: KOVACS & TARR BENCHWORKS · BATCH ${String(d.seed % 97).padStart(2, "0")} · TRAINING CHARGE (non-lethal, allegedly)`;
  }
};

/** Recompute the desired toolset from game state and reconcile registrations. */
function refresh(): void {
  const desired: { spec: ToolSpec; owner: unknown }[] = [
    { spec: getBriefing, owner: BASE_OWNER },
    { spec: getTrainingRecord, owner: BASE_OWNER },
    { spec: consultManual, owner: BASE_OWNER },
    { spec: getDeviceState, owner: BASE_OWNER },
    { spec: startMission, owner: BASE_OWNER }
  ];
  const d = game.device;
  if (d && d.result === null) {
    desired.push({ spec: scanDataTag, owner: d });
    for (const mod of d.modules) {
      if (mod.status === "armed") {
        for (const spec of mod.tools()) desired.push({ spec, owner: mod });
      }
    }
  } else if (d && d.result !== null && game.screen === "debrief") {
    desired.push({ spec: reviewLastSession, owner: d });
  }
  syncTools(desired);
}

let wired = false;
/** Install the WebMCP layer: initial registration + resync on every game transition. */
export function installWebMcp(): void {
  if (wired) return;
  wired = true;
  on("screen", refresh);
  on("lifecycle", refresh);
  refresh();
}

/** Re-export for state changes that alter the module toolset (module solved). */
export { refresh as refreshTools };
