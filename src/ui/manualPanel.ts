import { fullManual } from "../game/manual";
import { el } from "../lib/dom";

/** Render the canonical agent manual as a wrapping, printable human document. */
export function renderManualPanel(body: HTMLElement): () => void {
  const binderRings = el(
    "div",
    "manual-rings",
    '<span></span><span></span><span></span><span></span><span></span>'
  );
  const note = el(
    "div",
    "manual-note",
    `SOLO MODE: keep this field copy open — you become both halves of the team. ` +
      `In CO-OP, your agent reads these same sections through <b>consult_manual</b>.`
  );
  const print = el("button", "btn btn-ghost", "PRINT / SAVE PDF");
  print.addEventListener("click", () => window.print());

  const toolbar = el("div", "manual-toolbar");
  toolbar.innerHTML = `<div><span class="manual-revision">CT–TM–24 / REV 04</span><b>OPERATOR'S FIELD COPY</b></div>`;
  toolbar.appendChild(print);

  const manual = el("article", "manual-document manual-text");
  manual.setAttribute("aria-label", "CROSSTALK technical manual");
  const indexNav = el("nav", "manual-index");
  indexNav.setAttribute("aria-label", "Manual section index");
  const sections = fullManual().split(/\n\n─{20,}\n\n/);
  sections.forEach((text, index) => {
    const [heading, ...bodyLines] = text.split("\n");
    const section = el("section", "manual-section");
    section.id = `manual-section-${index}`;
    section.dataset.section = String(index).padStart(2, "0");
    const title = document.createElement("h2");
    title.textContent = heading;
    const content = el("pre", "manual-section-body");
    content.textContent = bodyLines.join("\n").trim();
    section.append(title, content);
    manual.appendChild(section);

    const link = document.createElement("a");
    link.href = `#${section.id}`;
    link.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span>${heading
      .replace(/^CROSSTALK TECHNICAL MANUAL\s*[—-]?\s*/i, "")
      .replace(/^SEC\.\s*\d+\.?\s*/i, "")}`;
    indexNav.appendChild(link);
  });

  const credits = el(
    "details",
    "manual-credits",
    `<summary>MAKER'S MARKS / TYPEFACE CREDITS</summary><p>Barlow Condensed by The Barlow Project Authors, B612 by Airbus, and Caveat by Pablo Impallari and contributors. Bundled locally under the SIL Open Font License 1.1. Original workbench illustrations by the CROSSTALK project.</p>`
  );
  body.append(binderRings, toolbar, note, indexNav, manual, credits);
  return () => undefined;
}
