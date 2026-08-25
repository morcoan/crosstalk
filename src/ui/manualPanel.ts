import { fullManual } from "../game/manual";
import { el, esc } from "../lib/dom";

/**
 * The printed manual drawer — the SOLO mode. It is the same text the agent
 * reads through consult_manual, rendered for human eyes. Having it on screen
 * proves the game is fully playable without an agent (and shows judges the
 * knowledge the agent is querying).
 */
export function renderManualPanel(body: HTMLElement): void {
  const note = el(
    "div",
    "manual-note",
    `SOLO MODE: play with this printed copy open — you become both halves of the team. ` +
      `In CO-OP, your agent reads these pages through the <b>consult_manual</b> tool instead.`
  );
  const print = el("button", "btn btn-ghost", "PRINT / SAVE PDF");
  print.addEventListener("click", () => window.print());
  const pre = el("pre", "manual-text");
  pre.innerHTML = esc(fullManual());
  body.append(note, print, pre);
}
