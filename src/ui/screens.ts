import { el, esc, copyText, store } from "../lib/dom";
import { armDevice, backToMenu, bestFor, fmtClock, game, goToBriefing, MISSIONS, rating } from "../game/state";
import { loadTrainingRecord, recommendMission, trainingTotals } from "../game/training";
import { webmcpAvailable } from "../webmcp/context";
import { renderDevice } from "./device";
import { toggleDrawer } from "./hud";
import { icon, missionPresentation } from "./presentation";

export const AGENT_PROMPT =
  "You are my defusal expert in CROSSTALK. Use your WebMCP tools: start with get_briefing and " +
  "get_training_record, recommend our drill, then use get_device_state and guide me step by step. " +
  "Never guess — ask me to read anything you can't sense, and tell me exactly what to press, cut or transmit.";

const REVIEW_PROMPT =
  "Call review_last_session. Tell us one observable thing we did well, one thing to improve, and which drill to run next. Then offer to file our field report.";

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
  wrap.innerHTML = `<span class="bench-mark mark-a">MEASURE TWICE</span><span class="bench-mark mark-b">↗ keep the line open</span>`;

  const topScene = el("div", "menu-top");

  const hero = el("section", "hero");
  hero.innerHTML = `
    <span class="placard-tape tape-left"></span><span class="placard-tape tape-right"></span>
    <div class="hero-eyebrow">FIELD COMMUNICATION EXERCISE / ISSUE 04</div>
    <h1 class="title">CROSS<span>TALK</span></h1>
    <p class="tagline">You see it. Your agent knows it. <b>Talk fast.</b></p>
    <p class="subline">A cooperative bomb-defusal game for one human and one AI teammate.
    Neither side has the whole picture.</p>
    <div class="hero-scribble">one device / two senses</div>`;
  topScene.appendChild(hero);

  const link = el("section", `linkcard ${linked ? "is-ok" : "is-warn"}`);
  link.innerHTML = linked
    ? `<span class="paper-clip"></span><span class="note-pin"></span><div class="linkcard-head">${icon("link")}<span><b>LINE TO AGENT: OPEN</b><small>Your teammate has the manual, scanner and remote controls.</small></span></div>
       <p>Copy the briefing into your agent chat, then choose a mission.</p>
       <details class="connection-help"><summary>Connection help and technical details</summary>
       <p>CROSSTALK exposes its equipment through WebMCP. If no agent chat is attached, use <b>AGENT KIT</b>
       to operate the same tools by hand, or connect through the
       <a href="https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd"
       target="_blank" rel="noreferrer">Model Context Tool Inspector</a>.</p></details>`
    : `<span class="paper-clip"></span><span class="note-pin"></span><div class="linkcard-head">${icon("link")}<span><b>LINE TO AGENT: CLOSED</b><small>Best experienced as a two-player communication game.</small></span></div>
       <p>Open CROSSTALK in ChatGPT's in-app browser or a WebMCP-enabled Chrome browser. Prefer to explore first?
       Open the <b>FIELD MANUAL</b> and play solo.</p>
       <details class="connection-help"><summary>How to enable the agent link</summary><p>Chrome 149+: enable
       <code>chrome://flags/#enable-webmcp-testing</code>, relaunch, and return here.</p></details>`;
  const promptRow = el("div", "prompt-row");
  const promptBox = el("details", "prompt-box");
  promptBox.innerHTML = `<summary>Preview agent briefing</summary><code>${esc(AGENT_PROMPT)}</code>`;
  const copyBtn = el("button", "btn btn-primary", "COPY BRIEFING");
  copyBtn.addEventListener("click", () => {
    void copyText(AGENT_PROMPT).then((ok) => {
      copyBtn.textContent = ok ? "COPIED ✓" : "COPY FAILED";
      setTimeout(() => (copyBtn.textContent = "COPY BRIEFING"), 1600);
    });
  });
  promptRow.append(promptBox, copyBtn);
  link.appendChild(promptRow);
  topScene.appendChild(link);
  wrap.appendChild(topScene);

  const record = loadTrainingRecord();
  const choices = MISSIONS.map(({ id, codename }) => ({ id, codename }));
  const totals = trainingTotals(record, choices);
  const recommended = recommendMission(record, choices);
  const dossier = el("section", "dossier");
  dossier.innerHTML = `
    <span class="punch-hole punch-a"></span><span class="punch-hole punch-b"></span>
    <div class="dossier-progress"><span class="dossier-kicker">FIELD RECORD / PUNCH CARD</span>
      <b>${totals.completed}/${MISSIONS.length} MISSIONS CLEARED</b>
      <span class="progress-track"><i style="width:${(totals.completed / MISSIONS.length) * 100}%"></i></span></div>
    <div class="dossier-stats"><b>${totals.cleanWins}</b> clean clear${totals.cleanWins === 1 ? "" : "s"}
      <span>·</span> <b>${totals.attempts}</b> completed run${totals.attempts === 1 ? "" : "s"}</div>
    <div class="dossier-next"><span>RECOMMENDED</span><b>${recommended.codename}</b></div>`;
  wrap.appendChild(dossier);

  const stackLabel = el("div", "mission-stack-label", `<span>CHOOSE A CASE FILE</span><i>Pull one. Brief together. Then arm.</i>`);
  wrap.appendChild(stackLabel);

  const grid = el("section", "mission-grid");
  MISSIONS.forEach((m, i) => {
    const best = bestFor(m.id);
    const art = missionPresentation[m.id];
    const isRecommended = recommended.id === m.id;
    const card = el("button", `mission-card mission-${m.id}${isRecommended ? " is-recommended" : ""}`);
    card.dataset.material = art.material;
    card.innerHTML = `
      <span class="folder-tab">${art.file}</span><span class="folder-fastener"></span>
      ${isRecommended ? '<div class="mission-ribbon">START HERE</div>' : ""}
      <div class="mission-top"><span class="mission-index">${String(i + 1).padStart(2, "0")}</span>
        <span class="mission-threat">${art.threat}</span></div>
      <div class="mission-insignia">${icon(art.icon)}</div>
      <div class="mission-name">${m.codename}</div>
      <div class="mission-flavor">${art.flavor}</div>
      <div class="mission-note">${art.note}</div>
      <div class="mission-meta"><span>${m.modules.length} MODULE${m.modules.length === 1 ? "" : "S"}</span><span>FUSE ${fmtClock(m.seconds * 1000)}</span></div>
      <div class="mission-best">${best ? `BEST ${fmtClock(best.msLeft)} · ${best.strikes} STRIKE${best.strikes === 1 ? "" : "S"}` : "UNTESTED DEVICE"}</div>
      <div class="mission-cta">OPEN BRIEFING <span>→</span></div>`;
    card.addEventListener("click", () => goToBriefing(m.id));
    grid.appendChild(card);
  });
  wrap.appendChild(grid);

  const how = el("section", "howto");
  how.innerHTML = `
    <div class="how-col"><span class="how-step">1</span>${icon("eye")}<h3>Look</h3><p>Read the colors, glyphs, gauges and sounds your agent cannot sense.</p></div>
    <span class="how-arrow">→</span>
    <div class="how-col"><span class="how-step">2</span>${icon("radio")}<h3>Call it out</h3><p>Your agent checks the manual and operates equipment on its side.</p></div>
    <span class="how-arrow">→</span>
    <div class="how-col"><span class="how-step">3</span>${icon("hand")}<h3>Commit</h3><p>Confirm the instruction, then press, cut or transmit before time runs out.</p></div>`;
  wrap.appendChild(how);

  const foot = el("footer", "menu-foot");
  foot.innerHTML = `Built on <a href="https://webmachinelearning.github.io/webmcp/" target="_blank" rel="noreferrer">WebMCP</a>
    · <a href="https://github.com/morcoan/crosstalk" target="_blank" rel="noreferrer">Source</a>
    · <span title="Barlow Condensed, B612 and Caveat — OFL 1.1">Typeface credits</span>
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
    <div class="folder-back"><span>${missionPresentation[m.id].file}</span></div>
    <div class="brief-docket">
      <span class="paper-clip brief-clip"></span><span class="brief-tape"></span>
      <div class="brief-kicker">FIELD ASSIGNMENT · ${missionPresentation[m.id].threat} · ${missionPresentation[m.id].file}</div>
      <div class="brief-heading"><div class="brief-insignia">${icon(missionPresentation[m.id].icon)}</div>
        <div><h2 class="brief-name">${m.codename}</h2><div class="brief-meta">${m.modules.length} MODULE${m.modules.length === 1 ? "" : "S"} · FUSE ${fmtClock(m.seconds * 1000)} · 3 STRIKES</div></div></div>
      <p class="brief-text">${m.brief}</p>
      <div class="brief-modules">${m.modules.map((kind) => `<span>${kind.replace("signal", "signal tx").toUpperCase()}</span>`).join("")}</div>
    </div>
    <div class="brief-roles">
      <div class="human-note">${icon("eye")}<span><b>YOUR SIDE</b>Describe what you see and hear. Perform the physical actions.</span></div>
      <div class="agent-note">${icon("wrench")}<span><b>AGENT SIDE</b>Read the manual, scan the device and operate remote servos.</span></div>
    </div>`;
  const tip = el(
    "div",
    "brief-tip",
    webmcpAvailable()
      ? `Before arming, tell your agent: <b>“Brief us for ${m.codename}.”</b> Start the clock when both of you are ready.`
      : `Solo mode: open the <b>FIELD MANUAL</b> before arming. The clock starts immediately.`
  );
  wrap.appendChild(tip);

  const row = el("div", "brief-actions");
  const arm = el("button", "btn btn-arm", `ARM DEVICE · ${fmtClock(m.seconds * 1000)}`);
  arm.addEventListener("click", () => armDevice(m));
  const back = el("button", "btn btn-ghost", "← MISSION SELECT");
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
    return JSON.parse(store.get("crosstalk.reports") ?? "[]") as FieldReport[];
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
  const board = el("div", "debrief-board");
  board.innerHTML = `<span class="board-pencil"></span><span class="board-clip clip-left"></span><span class="board-clip clip-right"></span>`;
  const sheet = el("article", "debrief-sheet");
  sheet.innerHTML = `
    <div class="report-number">AFTER-ACTION REPORT / ${d.serial}</div>
    <div class="debrief-stamp">${icon(win ? "shield" : "wire")}<span>${win ? "CLEARED" : "FAILED"}</span></div>
    <div class="debrief-banner">${win ? "DEVICE DISARMED" : "DEVICE DETONATED"}</div>
    <div class="debrief-sub">${d.mission.codename} · SERIAL ${d.serial}</div>
    <div class="debrief-stats">
      <div class="stat"><span>${win ? fmtClock(d.msLeft) : "00:00"}</span><label>time left</label></div>
      <div class="stat"><span>${d.strikes}/3</span><label>strikes</label></div>
      <div class="stat"><span>${d.toolCalls}</span><label>team radio calls</label></div>
      <div class="stat stat-rating"><span>${rating(d)}</span><label>field grade</label></div>
    </div>`;
  board.appendChild(sheet);
  wrap.appendChild(board);

  const coaching = el("section", "coaching");
  coaching.innerHTML = `<div>${icon("radio")}<span><h3>REVIEW THE RUN TOGETHER</h3>
    <p>Ask your agent for one strength, one improvement and the best next drill. The review uses device events only—not your private conversation.</p></span></div>`;
  const coachingActions = el("div", "coaching-actions");
  const reviewBtn = el("button", "btn btn-primary", "COPY REVIEW REQUEST");
  reviewBtn.addEventListener("click", () => {
    void copyText(REVIEW_PROMPT).then((ok) => {
      reviewBtn.textContent = ok ? "COPIED ✓" : "COPY FAILED";
      setTimeout(() => (reviewBtn.textContent = "COPY REVIEW REQUEST"), 1600);
    });
  });
  coachingActions.appendChild(reviewBtn);
  const next = nextMission(d.mission.id);
  if (win && next) {
    const nextBtn = el("button", "btn btn-next", `NEXT: ${next.codename} →`);
    nextBtn.addEventListener("click", () => goToBriefing(next.id));
    coachingActions.prepend(nextBtn);
  }
  coaching.appendChild(coachingActions);
  sheet.appendChild(coaching);

  // FIELD SKILLS — the impact thesis, demonstrated: name what the player just practiced.
  const skills = el("section", "skills");
  skills.innerHTML = `<h3>SKILLS PRACTICED</h3>${skillLines(d, win)
    .map((s) => `<div class="skill-row"><span class="skill-medal">✓</span><span class="skill-name">${s[0]}</span><span class="skill-note">${s[1]}</span></div>`)
    .join("")}`;
  sheet.appendChild(skills);

  // Declarative WebMCP tool: a plain HTML form annotated with toolname/tooldescription.
  // While this screen is mounted, agents see a `file_field_report` tool.
  const reportWrap = document.createElement("details");
  reportWrap.className = "report";
  reportWrap.innerHTML = `<summary>FIELD REPORT & SQUAD LOG <span>OPTIONAL</span></summary>
    <p class="hint">Save a callsign and one-line note for this device. Your agent can also file this report.</p>`;
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
      value="${esc(store.get("crosstalk.callsign") ?? "")}"
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
    store.set("crosstalk.reports", JSON.stringify(all));
    store.set("crosstalk.callsign", callsign);
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
  sheet.appendChild(reportWrap);

  const row = el("div", "brief-actions");
  const again = el("button", "btn btn-arm", "RE-ARM SAME MISSION");
  again.addEventListener("click", () => goToBriefing(d.mission.id));
  const menu = el("button", "btn btn-ghost", "← MISSION SELECT");
  menu.addEventListener("click", () => backToMenu());
  row.append(menu, again);
  sheet.appendChild(row);
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

/**
 * Derive "what you practiced" from the mission's activity feed — the game's
 * impact thesis (agent literacy through play), demonstrated with real numbers.
 */
function skillLines(d: NonNullable<typeof game.device>, win: boolean): [string, string][] {
  const t = d.telemetry;
  const solved = d.modules.filter((m) => m.status === "solved").length;

  if (d.toolCalls === 0) {
    return [
      ["SOLO RUN", "you played both halves with the printed manual — now try it with an agent on your side."],
      ["MODULES CLEARED", `${solved}/${d.modules.length} solved by hand and eye alone.`]
    ];
  }
  const lines: [string, string][] = [
    ["DELEGATION", `your agent worked its side: ${d.toolCalls} tool call${d.toolCalls === 1 ? "" : "s"} — ${t.agentReads} sensor/manual reads, ${t.agentActuations} servo actuation${t.agentActuations === 1 ? "" : "s"}.`],
    ["SENSORY HANDOFF", `${solved}/${d.modules.length} modules cleared on channels requiring human-only signals — paint, glyphs, needles, displays or beeps.`],
    ["HUMAN IN THE LOOP", t.irreversibleConfirmations > 0 ? `${t.irreversibleConfirmations} irreversible action${t.irreversibleConfirmations === 1 ? "" : "s"} went through your hands after an explicit on-screen confirmation.` : `${t.humanActions} physical input${t.humanActions === 1 ? "" : "s"} recorded; no irreversible action was confirmed.`],
    ["TRUST CALIBRATION", d.strikes === 0 ? "zero strikes — you verified before acting, every time." : `${d.strikes} strike${d.strikes === 1 ? "" : "s"} — wrong guesses cost; verify before you act.`]
  ];
  if (win) {
    lines.push(["THE LOOP", "describe → look up → decide → confirm → act. That's the skill of working with agents — you just drilled it."]);
  }
  return lines;
}
