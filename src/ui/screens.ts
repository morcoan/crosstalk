import { el, esc, copyText } from "../lib/dom";
import { armDevice, backToMenu, bestFor, fmtClock, game, goToBriefing, MISSIONS, rating } from "../game/state";
import { webmcpAvailable } from "../webmcp/context";
import { renderDevice } from "./device";
import { toggleDrawer } from "./hud";

export const AGENT_PROMPT =
  "You are my defusal expert in CROSSTALK. Use your WebMCP tools: start with get_briefing, then " +
  "get_device_state, and guide me step by step. Never guess — ask me to read anything you can't " +
  "sense, and tell me exactly what to press, cut or transmit.";

export function renderScreen(root: HTMLElement): void {
  root.innerHTML = "";
  switch (game.screen) {
    case "menu":
      return renderMenu(root);
    case "briefing":
      return renderBriefing(root);
    case "active":
      return renderDevice(root);
    case "debrief":
      return renderDebrief(root);
  }
}

/* ------------------------------ MENU ------------------------------ */

function renderMenu(root: HTMLElement): void {
  const linked = webmcpAvailable();
  const wrap = el("div", "screen menu");

  const hero = el("section", "hero");
  hero.innerHTML = `
    <h1 class="title">CROSS<span>TALK</span></h1>
    <p class="tagline">A cooperative defusal game for <b>one human</b> and <b>one AI agent</b>.</p>
    <p class="subline">You see the device. Your agent holds the manual, the scanner and the servos.
    Neither of you can disarm it alone — the game lives in what you tell each other.</p>`;
  wrap.appendChild(hero);

  const link = el("section", `linkcard ${linked ? "is-ok" : "is-warn"}`);
  link.innerHTML = linked
    ? `<div class="linkcard-head"><span class="led led-green"></span> AGENT LINK ESTABLISHED</div>
       <p>This browser exposes WebMCP — your agent can already see the game's tools.
       Open your agent's chat and paste the opener:</p>`
    : `<div class="linkcard-head"><span class="led led-amber"></span> NO AGENT LINK DETECTED</div>
       <p>To play CO-OP, open this page in <b>ChatGPT's in-app browser</b> or <b>Chrome 149+</b> with
       <code>chrome://flags/#enable-webmcp-testing</code> enabled. Or play <b>SOLO</b> with the printed
       manual (MANUAL, top right) — and inspect everything an agent would see via TOOLS.</p>`;
  const promptRow = el("div", "prompt-row");
  const promptBox = el("code", "prompt-box", esc(AGENT_PROMPT));
  const copyBtn = el("button", "btn btn-ghost", "COPY OPENER");
  copyBtn.addEventListener("click", () => {
    void copyText(AGENT_PROMPT).then((ok) => {
      copyBtn.textContent = ok ? "COPIED ✓" : "COPY FAILED";
      setTimeout(() => (copyBtn.textContent = "COPY OPENER"), 1600);
    });
  });
  promptRow.append(promptBox, copyBtn);
  link.appendChild(promptRow);
  wrap.appendChild(link);

  const grid = el("section", "mission-grid");
  MISSIONS.forEach((m, i) => {
    const best = bestFor(m.id);
    const card = el("button", "mission-card");
    card.innerHTML = `
      <div class="mission-index">${String(i + 1).padStart(2, "0")}</div>
      <div class="mission-name">${m.codename}</div>
      <div class="mission-meta">${m.tagline} · fuse ${fmtClock(m.seconds * 1000)}</div>
      <div class="mission-best">${best ? `BEST: ${fmtClock(best.msLeft)} left · ${best.strikes} strike(s)` : "NO RECORD"}</div>
      <div class="mission-cta">OPEN BRIEFING ▸</div>`;
    card.addEventListener("click", () => goToBriefing(m.id));
    grid.appendChild(card);
  });
  wrap.appendChild(grid);

  const how = el("section", "howto");
  how.innerHTML = `
    <div class="how-col"><h3>YOU SEE</h3><p>Wire colors, glyphs, gauge needles, displays, beeps —
      painted pixels and sound an agent can't sense. And only you can press, cut and transmit.</p></div>
    <div class="how-col"><h3>YOUR AGENT KNOWS</h3><p>The technical manual, the RFID serial scanner and
      servo actuators — exposed to it as live WebMCP tools that appear and vanish with the device state.</p></div>
    <div class="how-col"><h3>YOU TALK</h3><p>Describe what you see; your agent applies the rules and
      calls its tools; you act with your hands. Three strikes or zero seconds and it's confetti. Loud confetti.</p></div>`;
  wrap.appendChild(how);

  const foot = el("footer", "menu-foot");
  foot.innerHTML = `Built on <a href="https://webmachinelearning.github.io/webmcp/" target="_blank" rel="noreferrer">WebMCP</a>
    · <a href="https://github.com/morcoan/crosstalk" target="_blank" rel="noreferrer">Source</a>
    · All modules run locally — no accounts, no servers.`;
  wrap.appendChild(foot);

  root.appendChild(wrap);
}

/* ---------------------------- BRIEFING ---------------------------- */

function renderBriefing(root: HTMLElement): void {
  const m = game.briefingMission;
  if (!m) {
    backToMenu();
    return;
  }
  const wrap = el("div", "screen briefing");
  wrap.innerHTML = `
    <div class="brief-kicker">MISSION BRIEFING</div>
    <h2 class="brief-name">${m.codename}</h2>
    <div class="brief-meta">${m.tagline} · FUSE ${fmtClock(m.seconds * 1000)} · STRIKES 3</div>
    <p class="brief-text">${m.brief}</p>
    <div class="brief-roles">
      <div><b>YOUR JOB:</b> read the device aloud, act with your hands, keep your nerve.</div>
      <div><b>AGENT'S JOB:</b> get_briefing → consult_manual → tell you exactly what to do.</div>
    </div>`;
  const tip = el(
    "div",
    "brief-tip",
    webmcpAvailable()
      ? `Tell your agent a device is coming — it can pre-read the manual sections for: <b>${m.modules.join(", ")}</b>.`
      : `No agent link — open the MANUAL drawer (top right) to play solo before you arm.`
  );
  wrap.appendChild(tip);

  const row = el("div", "brief-actions");
  const arm = el("button", "btn btn-arm", `ARM DEVICE ▸ ${fmtClock(m.seconds * 1000)}`);
  arm.addEventListener("click", () => armDevice(m));
  const back = el("button", "btn btn-ghost", "◂ BACK");
  back.addEventListener("click", () => backToMenu());
  row.append(back, arm);
  wrap.appendChild(row);
  root.appendChild(wrap);
}

/* ---------------------------- DEBRIEF ----------------------------- */

interface FieldReport {
  callsign: string;
  note: string;
  mission: string;
  result: string;
  when: number;
}

function loadReports(): FieldReport[] {
  try {
    return JSON.parse(localStorage.getItem("crosstalk.reports") ?? "[]") as FieldReport[];
  } catch {
    return [];
  }
}

function renderDebrief(root: HTMLElement): void {
  const d = game.device;
  if (!d) {
    backToMenu();
    return;
  }
  const win = d.result === "disarmed";
  const wrap = el("div", `screen debrief ${win ? "is-win" : "is-loss"}`);
  wrap.innerHTML = `
    <div class="debrief-banner">${win ? "DEVICE DISARMED" : "DEVICE DETONATED"}</div>
    <div class="debrief-sub">${d.mission.codename} · SERIAL ${d.serial}</div>
    <div class="debrief-stats">
      <div class="stat"><span>${win ? fmtClock(d.msLeft) : "00:00"}</span><label>time left</label></div>
      <div class="stat"><span>${d.strikes}/3</span><label>strikes</label></div>
      <div class="stat"><span>${d.toolCalls}</span><label>agent tool calls</label></div>
      <div class="stat"><span>${rating(d)}</span><label>rating</label></div>
    </div>`;

  // Declarative WebMCP tool: a plain HTML form annotated with toolname/tooldescription.
  // While this screen is mounted, agents see a `file_field_report` tool.
  const reportWrap = el("section", "report");
  reportWrap.innerHTML = `<h3>FIELD REPORT</h3>
    <p class="hint">Filed reports land in the squad log below. (This form is itself a WebMCP tool —
    the declarative API: your agent can file it for you.)</p>`;
  const form = document.createElement("form");
  form.className = "report-form";
  form.setAttribute("toolname", "file_field_report");
  form.setAttribute(
    "tooldescription",
    "File the post-mission field report for the squad log: a team callsign and a short after-action note summarizing how the mission went."
  );
  form.setAttribute("toolautosubmit", "");
  form.innerHTML = `
    <label for="callsign">TEAM CALLSIGN</label>
    <input id="callsign" name="callsign" maxlength="24" required
      value="${esc(localStorage.getItem("crosstalk.callsign") ?? "")}"
      toolparamdescription="Short team callsign, e.g. WIRE WOLVES">
    <label for="note">AFTER-ACTION NOTE</label>
    <input id="note" name="note" maxlength="140"
      toolparamdescription="One-line after-action note for the log">
    <button type="submit" class="btn btn-primary">FILE REPORT</button>`;
  const logEl = el("div", "squad-log");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const callsign = String(fd.get("callsign") ?? "").trim() || "UNNAMED SQUAD";
    const note = String(fd.get("note") ?? "").trim();
    const report: FieldReport = {
      callsign,
      note,
      mission: d.mission.codename,
      result: win ? `disarmed, ${fmtClock(d.msLeft)} left` : "detonated",
      when: Date.now()
    };
    const all = [report, ...loadReports()].slice(0, 12);
    localStorage.setItem("crosstalk.reports", JSON.stringify(all));
    localStorage.setItem("crosstalk.callsign", callsign);
    paintLog();
    const ev = e as SubmitEvent & { agentInvoked?: boolean; respondWith?(p: Promise<unknown>): void };
    if (ev.agentInvoked && typeof ev.respondWith === "function") {
      ev.respondWith(Promise.resolve(`Field report filed for ${callsign}: "${note}" (${report.result}).`));
    }
  });
  const paintLog = (): void => {
    const all = loadReports();
    logEl.innerHTML = all.length
      ? `<h4>SQUAD LOG</h4>` +
        all
          .map(
            (r) =>
              `<div class="log-row"><b>${esc(r.callsign)}</b> · ${esc(r.mission)} · ${esc(r.result)}${
                r.note ? ` — “${esc(r.note)}”` : ""
              }</div>`
          )
          .join("")
      : "";
  };
  paintLog();
  reportWrap.append(form, logEl);
  wrap.appendChild(reportWrap);

  const row = el("div", "brief-actions");
  const again = el("button", "btn btn-arm", "RE-ARM SAME MISSION");
  again.addEventListener("click", () => goToBriefing(d.mission.id));
  const next = nextMission(d.mission.id);
  if (win && next) {
    const nextBtn = el("button", "btn btn-primary", `NEXT: ${next.codename} ▸`);
    nextBtn.addEventListener("click", () => goToBriefing(next.id));
    row.appendChild(nextBtn);
  }
  const menu = el("button", "btn btn-ghost", "◂ MISSION SELECT");
  menu.addEventListener("click", () => backToMenu());
  row.append(menu, again);
  wrap.appendChild(row);
  root.appendChild(wrap);

  // Console/tools hint after a loss
  if (!win) {
    const hint = el(
      "div",
      "debrief-hint",
      `Tip: your agent could have checked <b>get_device_state</b> mid-mission — open TOOLS to see everything it can do.`
    );
    hint.addEventListener("click", () => toggleDrawer("console"));
    wrap.appendChild(hint);
  }
}

function nextMission(id: string): (typeof MISSIONS)[number] | null {
  const i = MISSIONS.findIndex((m) => m.id === id);
  return i >= 0 && i + 1 < MISSIONS.length ? MISSIONS[i + 1] : null;
}
