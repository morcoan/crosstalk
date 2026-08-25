import { on } from "../lib/bus";
import { manualSection, MANUAL_SECTIONS } from "../game/manual";
import { bestFor, fmtClock, game, goToBriefing, MISSIONS, missionLive, rating } from "../game/state";
import type { ToolSpec } from "../game/types";
import { syncTools } from "./context";

/**
 * Tool orchestration. Three tiers, mirroring the game state exactly:
 *  - BASE tools: always live (briefing, manual, device state, mission start).
 *  - MISSION tools: live only while a device is armed (the RFID scanner).
 *  - MODULE tools: owned by armed modules; they vanish the moment a module is
 *    solved (per-tool AbortControllers → the browser fires `toolchange`).
 */

const BASE_OWNER = "base";

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
    const missions = MISSIONS.map((m) => {
      const best = bestFor(m.id);
      return `- id "${m.id}" — ${m.codename} (${m.tagline}, ${fmtClock(m.seconds * 1000)} fuse)${
        best ? ` · best: disarmed with ${fmtClock(best.msLeft)} left` : ""
      }`;
    }).join("\n");
    return `CROSSTALK — AGENT BRIEFING
You and your human partner are a bomb-disposal team. A device with a countdown timer and
several modules is on the bench. You two share the work, but not the senses:

YOUR SIDE (the agent): the technical manual (consult_manual), the RFID serial scanner
(scan_data_tag, while a device is armed), servo actuators on certain modules, and perfect
memory. YOU decide what to do.
THEIR SIDE (the human): eyes and hands. Paint colors, glyphs, needles, displays and beeps
are not machine-readable, and only the human can cut wires, press keys and hit TRANSMIT.

ETIQUETTE (read carefully — this keeps the device intact):
1. Call get_device_state to see what is armed, then consult_manual for those modules.
2. Never guess. If a rule needs something you cannot sense, ask your partner to read it aloud.
3. Before anything irreversible (cut/lock/transmit) state the rule and the exact action.
4. Be brief and imperative: "Cut wire 3." beats a paragraph.
5. Three strikes — or the timer at zero — detonates the device.

MISSIONS:
${missions}

To play: call start_mission with a mission id (or ask your partner to pick one on screen).
The human presses ARM DEVICE to start the clock. Good luck — keep the crosstalk crisp.`;
  }
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
