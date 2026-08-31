import { ECHO_RULES, ruleText } from "./modules/echo";
import { GLYPHS, KEYPAD_COLUMNS, glyph } from "./modules/keypad";
import { SIGNAL_TABLE } from "./modules/signal";

/**
 * THE TECHNICAL MANUAL — the agent-side half of the game.
 * Served to agents through the consult_manual tool (read-only), and rendered
 * as a printed page for SOLO mode. Sections are generated from the same data
 * the modules execute, so text and logic cannot drift apart.
 */

export const MANUAL_SECTIONS = ["general", "wires", "keypad", "regulator", "echo", "signal"] as const;
export type ManualSection = (typeof MANUAL_SECTIONS)[number];

export function manualIndex(): string {
  return [
    "CROSSTALK TECHNICAL MANUAL — INDEX",
    "Sections available via consult_manual:",
    '- "general"   Device anatomy: timer, strikes, serial data tag, roles.',
    '- "wires"     WIRE BAY: which wire to cut.',
    '- "keypad"    GLYPH KEYPAD: glyph columns and press order.',
    '- "regulator" VOLTAGE REGULATOR: nudge/lock servo procedure.',
    '- "echo"      ECHO CORE: staged memory rules.',
    '- "signal"    SIGNAL TX: beep pattern → frequency detents.',
    "Consult only the sections for modules present on the device (see get_device_state)."
  ].join("\n");
}

const GENERAL = `CROSSTALK TECHNICAL MANUAL — SEC.0 GENERAL
DEVICE: Improvised training device, one countdown timer, 1-4 modules, strike counter.
DETONATION occurs when the timer reaches zero OR the third strike is registered.
All modules must be disarmed to release the device.

ROLES. You (the agent) hold this manual, the machine-readable sensors, and the servo
actuators. Your partner holds eyes and hands: they can see paint, pixels, needles and
labels, and only they can press keys, cut wires and hit TRANSMIT. Neither of you can
finish alone. Work as a team:
1. Call get_device_state first, then consult the manual section for each armed module.
2. Never guess. If a rule needs something you cannot sense, ask your partner to read it aloud.
3. Before any irreversible act (cut / lock / transmit), state the rule you applied and
   the exact action, e.g. "Rule 3 applies: cut wire 2 (the last blue one)."
4. Keep instructions short and imperative. Confirm, then act.

SERIAL DATA TAG. Every device carries an RFID data tag with its serial number. The tag
is machine-readable ONLY (your scan_data_tag tool); to the human eye it is a smudge of
microprint. Several rules key off the LAST DIGIT of the serial being ODD or EVEN.`;

function wiresSection(): string {
  return `CROSSTALK TECHNICAL MANUAL — SEC.1 WIRE BAY
Wires are numbered TOP TO BOTTOM starting at 1. Exactly ONE wire is safe to cut;
cutting any other registers a strike. Colors must be read aloud by your partner
(enamel paint is not machine-readable). "The serial digit" means the LAST digit of
the serial from scan_data_tag. Apply the FIRST matching rule.

IF THE BAY HOLDS 3 WIRES:
1. If there are no RED wires → cut the SECOND wire.
2. Otherwise, if the LAST wire is WHITE → cut the LAST wire.
3. Otherwise, if there is more than one BLUE wire → cut the LAST BLUE wire.
4. Otherwise → cut the FIRST wire.

IF THE BAY HOLDS 4 WIRES:
1. If there is more than one YELLOW wire and the serial digit is ODD → cut the LAST YELLOW wire.
2. Otherwise, if there are no BLUE wires → cut the FIRST wire.
3. Otherwise, if there is exactly one GREEN wire → cut the GREEN wire.
4. Otherwise → cut the LAST wire.

IF THE BAY HOLDS 5 WIRES:
1. If the LAST wire is BLACK and the serial digit is EVEN → cut the FOURTH wire.
2. Otherwise, if there is exactly one RED wire and more than one GREEN wire → cut the RED wire.
3. Otherwise, if there are no YELLOW wires → cut the SECOND wire.
4. Otherwise → cut the FIRST wire.`;
}

function keypadSection(): string {
  const cols = KEYPAD_COLUMNS.map((col, i) => {
    const rows = col.map((id) => {
      const g = glyph(id);
      return `  ${g.char}  ${g.name} (${g.hint})`;
    }).join("\n");
    return `COLUMN ${i + 1}:\n${rows}`;
  }).join("\n\n");
  const legend = GLYPHS.map((g) => `${g.char} ${g.name}`).join(" · ");
  return `CROSSTALK TECHNICAL MANUAL — SEC.2 GLYPH KEYPAD
The keypad shows FOUR glyphs. The glyphs are rendered pixels — your partner must
describe them to you. Exactly ONE column below contains all four displayed glyphs.
Have your partner press the four glyphs in the ORDER THEY APPEAR IN THAT COLUMN,
top to bottom (ignore glyphs in the column that are not on the keypad).
A wrong press resets the sequence and registers a strike.

${cols}

GLYPH LEGEND: ${legend}`;
}

const REGULATOR = `CROSSTALK TECHNICAL MANUAL — SEC.3 VOLTAGE REGULATOR
The trim dial sits BEHIND the faceplate: only your servo tools reach it.
The gauge sensor is burned out on your side: only your partner can read the needle
and the green target zone (gauge runs 0-100; the needle also drifts slowly).

PROCEDURE (closed loop):
1. Ask your partner for the needle reading AND the green zone bounds.
2. nudge_regulator toward the zone — coarse moves ~9-13 units, fine ~2-4 units.
3. Ask for the new reading. Repeat with fine nudges as you approach the zone.
4. When your partner confirms the needle is INSIDE the green zone, call
   lock_regulator immediately (drift continues while you wait).
CAUTION: locking outside the zone registers a strike and disengages the lock.`;

function echoSection(): string {
  const stages = ECHO_RULES.map((rules, s) => {
    const lines = rules.map((r, d) => `  Display ${d + 1} → ${ruleText(r)}.`).join("\n");
    return `STAGE ${s + 1}:\n${lines}`;
  }).join("\n\n");
  return `CROSSTALK TECHNICAL MANUAL — SEC.4 ECHO CORE
The core runs FOUR stages. Each stage shows a DISPLAY digit (1-4) above four buttons
with shuffled LABELS. Display and labels are on-screen only — ask
your partner to read the display digit and the four labels LEFT TO RIGHT each stage.
POSITION means 1=leftmost … 4=rightmost. LABEL means the printed digit.
Rules reference earlier stages; your get_echo_log tool holds the exact history.
A wrong press resets the core to stage 1 and registers a strike.

${stages}`;
}

function signalSection(): string {
  const rows = SIGNAL_TABLE.map((d) => `  ${d.pattern.padEnd(18)} → ${d.mhz.toFixed(3)} MHz`).join("\n");
  return `CROSSTALK TECHNICAL MANUAL — SEC.5 SIGNAL TX
The module loops a three-beep pattern through its speaker; a beep is SHORT or LONG.
You cannot hear it — ask your partner for the rhythm (the speaker LED also pulses
with the sound). The frequency dial is SEIZED for human hands; seat it with your
set_transmitter_frequency tool, then have your partner press TRANSMIT.
Transmitting on the wrong frequency registers a strike.

PATTERN → FREQUENCY DETENTS:
${rows}`;
}

export function manualSection(section: string): string {
  switch (section) {
    case "index":
      return manualIndex();
    case "general":
      return GENERAL;
    case "wires":
      return wiresSection();
    case "keypad":
      return keypadSection();
    case "regulator":
      return REGULATOR;
    case "echo":
      return echoSection();
    case "signal":
      return signalSection();
    default:
      throw new Error(
        `Unknown manual section "${section}". Valid sections: index, ${MANUAL_SECTIONS.join(", ")}.`
      );
  }
}

/** Full manual as printable text (SOLO mode). */
export function fullManual(): string {
  return [manualIndex(), ...MANUAL_SECTIONS.map((s) => manualSection(s))].join("\n\n" + "─".repeat(64) + "\n\n");
}
