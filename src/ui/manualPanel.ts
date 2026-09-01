import { fullManual } from "../game/manual";
import { el } from "../lib/dom";

/** Render the canonical agent manual as a wrapping, printable human document. */
export function renderManualPanel(body: HTMLElement): () => void {
  const note = el(
    "div",
    "manual-note",
    `SOLO MODE: keep this field copy open — you become both halves of the team. ` +
      `In CO-OP, your agent reads these same sections through <b>consult_manual</b>.`
  );
  const print = el("button", "btn btn-ghost", "PRINT / SAVE PDF");
  print.addEventListener("click", () => window.print());

  const manual = el("article", "manual-document manual-text");
  manual.setAttribute("aria-label", "CROSSTALK technical manual");
  const sections = fullManual().split(/\n\n─{20,}\n\n/);
  sections.forEach((text, index) => {
    const [heading, ...bodyLines] = text.split("\n");
    const section = el("section", "manual-section");
    section.id = `manual-section-${index}`;
    const title = document.createElement("h2");
    title.textContent = heading;
    const content = el("pre", "manual-section-body");
    content.textContent = bodyLines.join("\n").trim();
    section.append(title, content);
    manual.appendChild(section);
  });

  const credits = el(
    "details",
    "manual-credits",
    `<summary>MAKER'S MARKS / TYPEFACE CREDITS</summary><p>Barlow Condensed by The Barlow Project Authors, B612 by Airbus, and Caveat by Pablo Impallari and contributors. Bundled locally under the SIL Open Font License 1.1. Original workbench illustrations by the CROSSTALK project.</p>`
  );
  body.append(note, print, manual, credits);
  return () => undefined;
}
