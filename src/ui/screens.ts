import { el, esc, copyText, store } from "../lib/dom";
import { on } from "../lib/bus";
import { armDevice, backToMenu, bestFor, fmtClock, game, goToBriefing, MISSIONS, rating } from "../game/state";
import { loadTrainingRecord, recommendMission, trainingTotals } from "../game/training";
import { webmcpHealth } from "../webmcp/context";
import { disposeDeviceUi, renderDevice } from "./device";
import { resetHudForScreenTransition, toggleDrawer } from "./hud";
import { icon, missionDiagram, missionPresentation } from "./presentation";

export const AGENT_PROMPT =
  "You are my defusal expert in CROSSTALK. Use your WebMCP tools: start with get_briefing and " +
  "get_training_record, recommend our drill, then use get_device_state and guide me step by step. " +
  "Never guess — ask me to read anything you can't sense, and tell me exactly what to press, cut or transmit.";

const REVIEW_PROMPT =
  "Call review_last_session. Tell us one observable thing we did well, one thing to improve, and which drill to run next. Then offer to file our field report.";

let disposeScreenSubscription: (() => void) | null = null;

function disposeScreenListener(): void {
  disposeScreenSubscription?.();
  disposeScreenSubscription = null;
}

export function renderScreen(root: HTMLElement): void {
  disposeScreenListener();
  resetHudForScreenTransition();
  disposeDeviceUi();
  root.innerHTML = "";
  try {
    switch (game.screen) {
      case "menu":
        renderMenu(root);
        break;
      case "briefing":
        renderBriefing(root);
        break;
      case "active":
        renderDevice(root);
        break;
      case "debrief":
        renderDebrief(root);
        break;
    }
  } catch (error) {
    console.error("[crosstalk] screen render failed", error);
    disposeScreenListener();
    disposeDeviceUi();
    const recovery = el("section", "screen render-recovery");
    recovery.innerHTML = `<div class="brief-docket"><div class="brief-kicker">FIELD DISPLAY RECOVERY</div>
      <h1 data-screen-title tabindex="-1">DISPLAY INTERRUPTED</h1>
      <p>The equipment panel hit an unexpected fault. Your mission state was isolated; return to the mission board to recover safely.</p></div>`;
    const recover = el("button", "btn btn-arm", "RETURN TO MISSION SELECT");
    recover.addEventListener("click", () => backToMenu());
    recovery.appendChild(recover);
    root.replaceChildren(recovery);
  }
  resetScreenScroll();
  requestAnimationFrame(() => {
    resetScreenScroll();
    root.querySelector<HTMLElement>("[data-screen-title]")?.focus({ preventScroll: true });
  });
}

function resetScreenScroll(): void {
  // Direct assignments are immediate even when the authored page uses smooth anchor scrolling.
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

/* ------------------------------ MENU ------------------------------ */

function renderMenu(root: HTMLElement): void {
  const wrap = el("div", "screen menu");
  wrap.innerHTML = `<span class="bench-mark mark-a">MEASURE TWICE</span><span class="bench-mark mark-b">↗ keep the line open</span>`;

  const topScene = el("div", "menu-top");

  const hero = el("section", "hero");
  hero.innerHTML = `
    <span class="placard-tape tape-left"></span><span class="placard-tape tape-right"></span>
    <div class="hero-eyebrow">FIELD COMMUNICATION EXERCISE / ISSUE 04</div>
    <h1 class="title" data-screen-title tabindex="-1">CROSS<span>TALK</span></h1>
    <p class="tagline">You see it. Your agent knows it. <b>Talk fast.</b></p>
    <p class="subline">A cooperative bomb-defusal game for one human and one AI teammate.
    Neither side has the whole picture.</p>
    <div class="hero-scribble">one device / two senses</div>`;
  topScene.appendChild(hero);

  const link = el("section", "linkcard");
  link.innerHTML = `<span class="paper-clip"></span><span class="note-pin"></span>
    <div class="linkcard-head">${icon("link")}<span><b data-role="connection-title" aria-live="polite" aria-atomic="true"></b><small data-role="connection-detail"></small></span></div>
    <p data-role="connection-copy"></p>
    <details class="connection-help"><summary>Connection help and technical details</summary>
      <p>CROSSTALK exposes its equipment through WebMCP. Wait for the header to show <b>READY</b> before relying on the agent tool line. If it is unavailable or degraded, <b>AGENT KIT</b> invokes the same handlers locally. Chrome 149+ users can enable <code>chrome://flags/#enable-webmcp-testing</code>, relaunch, and return here. The <a href="https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd" target="_blank" rel="noreferrer">Model Context Tool Inspector</a> can also inspect the page tools.</p>
    </details>`;
  const connectionTitle = link.querySelector<HTMLElement>('[data-role="connection-title"]')!;
  const connectionDetail = link.querySelector<HTMLElement>('[data-role="connection-detail"]')!;
  const connectionCopy = link.querySelector<HTMLElement>('[data-role="connection-copy"]')!;
  const paintConnection = (): void => {
    const health = webmcpHealth();
    link.classList.toggle("is-ok", health.mode === "ready");
    link.classList.toggle("is-warn", health.mode === "local-only" || health.mode === "connecting");
    link.classList.toggle("is-error", health.mode === "degraded");
    if (health.mode === "ready") {
      connectionTitle.textContent = "WEBMCP TOOL LINE: READY";
      connectionDetail.textContent = `${health.ready} page tools are registered. An agent still needs this page and its briefing.`;
      connectionCopy.innerHTML = "Copy the briefing into your agent chat, then choose a mission. Tool readiness does not mean a teammate has joined yet.";
    } else if (health.mode === "connecting") {
      connectionTitle.textContent = "WEBMCP TOOL LINE: CONNECTING";
      connectionDetail.textContent = `${health.ready} of ${health.desired} page tools are registered.`;
      connectionCopy.innerHTML = "Choose a mission now, but wait for <b>READY</b> before relying on agent tools. <b>AGENT KIT</b> remains available locally.";
    } else if (health.mode === "degraded") {
      connectionTitle.textContent = "WEBMCP TOOL LINE: DEGRADED";
      connectionDetail.textContent = `${health.ready} of ${health.desired} page tools are ready; ${health.failed} failed to register.`;
      connectionCopy.innerHTML = "Registration will retry. Use <b>AGENT KIT</b> locally until the header reports <b>READY</b>.";
    } else {
      connectionTitle.textContent = "SOLO TOOL LINE: READY";
      connectionDetail.textContent = "WebMCP transport is unavailable here, but every mission remains playable.";
      connectionCopy.innerHTML = "Open the <b>FIELD MANUAL</b> or <b>AGENT KIT</b> to play locally, or reopen CROSSTALK in a WebMCP-enabled browser for co-op.";
    }
  };
  paintConnection();
  disposeScreenSubscription = on("tools", paintConnection);
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
      <span class="progress-track" role="progressbar" aria-label="Missions cleared" aria-valuemin="0" aria-valuemax="${MISSIONS.length}" aria-valuenow="${totals.completed}"><i style="width:${(totals.completed / MISSIONS.length) * 100}%"></i></span></div>
    <div class="dossier-stats"><b>${totals.cleanWins}</b> clean clear${totals.cleanWins === 1 ? "" : "s"}
      <span>·</span> <b>${totals.attempts}</b> completed run${totals.attempts === 1 ? "" : "s"}</div>
    <div class="dossier-next"><span>RECOMMENDED</span><b>${recommended.codename}</b></div>`;
  wrap.appendChild(dossier);

  const stackLabel = el("div", "mission-stack-label", `<span id="mission-tray-title">CHOOSE A CASE FILE</span><i>Pull one. Brief together. Then arm.</i>`);
  wrap.appendChild(stackLabel);

  const tray = el("section", "mission-tray");
  tray.setAttribute("aria-labelledby", "mission-tray-title");
  const trayControls = el("div", "mission-tray-controls");
  trayControls.setAttribute("role", "group");
  trayControls.setAttribute("aria-label", "Browse mission case files");
  const trayPrev = el("button", "mission-tray-nav mission-tray-prev", "← PREVIOUS");
  trayPrev.type = "button";
  trayPrev.setAttribute("aria-controls", "mission-tray-viewport");
  const trayPosition = el("span", "mission-tray-position", `01 / ${String(MISSIONS.length).padStart(2, "0")}`);
  trayPosition.setAttribute("aria-hidden", "true");
  const trayNext = el("button", "mission-tray-nav mission-tray-next", "NEXT →");
  trayNext.type = "button";
  trayNext.setAttribute("aria-controls", "mission-tray-viewport");
  trayControls.append(trayPrev, trayPosition, trayNext);

  const trayViewport = el("div", "mission-tray-viewport");
  trayViewport.id = "mission-tray-viewport";
  trayViewport.tabIndex = 0;
  trayViewport.setAttribute("role", "region");
  trayViewport.setAttribute("aria-roledescription", "carousel");
  trayViewport.setAttribute("aria-label", "Mission case file carousel");
  const trayStatus = el("span", "mission-tray-status sr-only");
  trayStatus.setAttribute("role", "status");
  trayStatus.setAttribute("aria-live", "polite");
  trayStatus.setAttribute("aria-atomic", "true");

  const grid = el("div", "mission-grid");
  const missionCards: HTMLButtonElement[] = [];
  MISSIONS.forEach((m, i) => {
    const best = bestFor(m.id);
    const art = missionPresentation[m.id];
    const isRecommended = recommended.id === m.id;
    const card = el("button", `mission-card mission-${m.id}${isRecommended ? " is-recommended" : ""}`);
    card.id = `mission-card-${m.id}`;
    card.type = "button";
    card.dataset.missionId = m.id;
    card.dataset.material = art.material;
    card.setAttribute(
      "aria-label",
      `Mission ${i + 1} of ${MISSIONS.length}: open ${m.codename} briefing. ${m.modules.length} module${m.modules.length === 1 ? "" : "s"}, ${fmtClock(m.seconds * 1000)} fuse${isRecommended ? ". Recommended next drill" : ""}.`
    );
    card.innerHTML = `
      <span class="folder-tab">${art.file}</span><span class="folder-fastener"></span>
      ${isRecommended ? '<div class="mission-ribbon">START HERE</div>' : ""}
      <div class="mission-top"><span class="mission-index">${String(i + 1).padStart(2, "0")}</span>
        <span class="mission-threat">${art.threat}</span></div>
      ${missionDiagram(m.id)}
      <div class="mission-insignia">${icon(art.icon)}</div>
      <div class="mission-name">${m.codename}</div>
      <div class="mission-flavor">${art.flavor}</div>
      <div class="mission-note">${art.note}</div>
      <div class="mission-meta"><span>${m.modules.length} MODULE${m.modules.length === 1 ? "" : "S"}</span><span>FUSE ${fmtClock(m.seconds * 1000)}</span></div>
      <div class="mission-best">${best ? `BEST ${fmtClock(best.msLeft)} · ${best.strikes} STRIKE${best.strikes === 1 ? "" : "S"}` : "UNTESTED DEVICE"}</div>
      <div class="mission-cta">OPEN BRIEFING <span>→</span></div>`;
    card.addEventListener("click", () => goToBriefing(m.id));
    grid.appendChild(card);
    missionCards.push(card);
  });
  trayViewport.appendChild(grid);
  tray.append(trayControls, trayViewport, trayStatus);
  wrap.appendChild(tray);

  let trayIndex = 0;
  const missionLeft = (card: HTMLButtonElement): number =>
    card.getBoundingClientRect().left - trayViewport.getBoundingClientRect().left + trayViewport.scrollLeft;
  const nearestMissionIndex = (): number => {
    const viewportCenter = trayViewport.scrollLeft + trayViewport.clientWidth / 2;
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    missionCards.forEach((card, index) => {
      const center = missionLeft(card) + card.offsetWidth / 2;
      const nextDistance = Math.abs(center - viewportCenter);
      if (nextDistance < distance) {
        nearest = index;
        distance = nextDistance;
      }
    });
    return nearest;
  };
  const updateTrayControls = (index = nearestMissionIndex(), announce = false): void => {
    const canScroll = trayViewport.scrollWidth > trayViewport.clientWidth + 4;
    trayIndex = canScroll ? index : 0;
    trayPrev.disabled = !canScroll || trayIndex === 0;
    trayNext.disabled = !canScroll || trayIndex === missionCards.length - 1;
    trayPosition.textContent = `${String(trayIndex + 1).padStart(2, "0")} / ${String(missionCards.length).padStart(2, "0")}`;
    if (announce) {
      const mission = MISSIONS[trayIndex];
      trayStatus.textContent = `${mission.codename}, mission ${trayIndex + 1} of ${MISSIONS.length}${mission.id === recommended.id ? ", recommended next drill" : ""}.`;
    }
  };
  const moveTray = (direction: -1 | 1): void => {
    const nextIndex = Math.max(0, Math.min(missionCards.length - 1, trayIndex + direction));
    const card = missionCards[nextIndex];
    const left = missionLeft(card) - Math.max(0, (trayViewport.clientWidth - card.offsetWidth) / 2);
    trayViewport.scrollTo({
      left: Math.max(0, left),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
    updateTrayControls(nextIndex, true);
  };
  trayPrev.addEventListener("click", () => moveTray(-1));
  trayNext.addEventListener("click", () => moveTray(1));
  let trayPaintTimer = 0;
  trayViewport.addEventListener("scroll", () => {
    window.clearTimeout(trayPaintTimer);
    trayPaintTimer = window.setTimeout(() => {
      if (trayViewport.isConnected) updateTrayControls();
    }, 90);
  }, { passive: true });

  const how = el("section", "howto");
  how.innerHTML = `
    <div class="how-col"><span class="how-step">1</span>${icon("eye")}<h2>Look</h2><p>Read the colors, glyphs, gauges and sounds your agent cannot sense.</p></div>
    <span class="how-arrow">→</span>
    <div class="how-col"><span class="how-step">2</span>${icon("radio")}<h2>Call it out</h2><p>Your agent checks the manual and operates equipment on its side.</p></div>
    <span class="how-arrow">→</span>
    <div class="how-col"><span class="how-step">3</span>${icon("hand")}<h2>Commit</h2><p>Confirm the instruction, then press, cut or transmit before time runs out.</p></div>`;
  wrap.appendChild(how);

  const foot = el("footer", "menu-foot");
  foot.innerHTML = `Built on <a href="https://webmachinelearning.github.io/webmcp/" target="_blank" rel="noreferrer">WebMCP</a>
    · <a href="https://github.com/morcoan/crosstalk" target="_blank" rel="noreferrer">Source</a>
    · <span title="Barlow Condensed, B612 and Caveat — OFL 1.1">Typeface credits</span>
    · All modules run locally — no accounts, no servers.`;
  wrap.appendChild(foot);

  root.appendChild(wrap);
  requestAnimationFrame(() => {
    if (trayViewport.isConnected) updateTrayControls();
  });
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
        <div><h1 class="brief-name" data-screen-title tabindex="-1">${m.codename}</h1><div class="brief-meta">${m.modules.length} MODULE${m.modules.length === 1 ? "" : "S"} · FUSE ${fmtClock(m.seconds * 1000)} · 3 STRIKES</div></div></div>
      <p class="brief-text">${m.brief}</p>
      <div class="brief-modules">${m.modules.map((kind) => `<span>${kind.replace("signal", "signal tx").toUpperCase()}</span>`).join("")}</div>
    </div>
    <section class="brief-preflight" aria-labelledby="brief-preflight-title">
      <div class="brief-preflight-head"><span class="brief-preflight-kicker">PRE-FLIGHT / THREE-PART HANDOFF</span><h2 id="brief-preflight-title">Confirm the line before the clock starts</h2></div>
      <ol class="brief-roles preflight-strip" aria-label="Preflight order: you, agent, then arm">
        <li class="preflight-step preflight-you"><span class="preflight-number" aria-hidden="true">01</span>${icon("eye")}<span class="preflight-copy"><b>YOU / OBSERVE</b>Read the colors, glyphs, gauges and sounds. You perform the physical actions.</span><span class="preflight-arrow" aria-hidden="true">→</span></li>
        <li class="preflight-step preflight-agent"><span class="preflight-number" aria-hidden="true">02</span>${icon("wrench")}<span class="preflight-copy"><b>AGENT / PREPARE</b>Open the required manual sections, scan machine-readable data and confirm the handoff.</span><span class="preflight-arrow" aria-hidden="true">→</span></li>
        <li class="preflight-step preflight-arm"><span class="preflight-number" aria-hidden="true">03</span>${icon("hand")}<span class="preflight-copy"><b>ARM / COMMIT</b>Start the clock only when both sides are ready. Confirm irreversible actions before touching the device.</span></li>
      </ol>
    </section>`;
  const tip = el("div", "brief-tip");
  tip.setAttribute("role", "status");
  tip.setAttribute("aria-atomic", "true");
  const paintBriefingStatus = (): void => {
    const health = webmcpHealth();
    if (health.mode === "ready") {
      tip.innerHTML = `Before arming, tell your agent: <b>“Brief us for ${m.codename}.”</b> Start the clock when both of you are ready.`;
    } else if (health.mode === "connecting") {
      tip.innerHTML = `WebMCP is connecting (${health.ready}/${health.desired} tools ready). Wait for <b>READY</b>, or open <b>AGENT KIT</b>, before arming.`;
    } else if (health.mode === "degraded") {
      tip.innerHTML = `WebMCP is degraded (${health.failed} tool${health.failed === 1 ? "" : "s"} failed). Use <b>AGENT KIT</b> locally, or wait for registration to recover, before arming.`;
    } else {
      tip.innerHTML = `Solo mode: open the <b>FIELD MANUAL</b> or <b>AGENT KIT</b> before arming. The clock starts immediately.`;
    }
  };
  paintBriefingStatus();
  disposeScreenSubscription = on("tools", paintBriefingStatus);
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
    const parsed: unknown = JSON.parse(store.get("crosstalk.reports") ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
      .flatMap((row) => {
        if (
          typeof row.callsign !== "string" ||
          typeof row.note !== "string" ||
          typeof row.mission !== "string" ||
          typeof row.result !== "string" ||
          typeof row.when !== "number" ||
          !Number.isSafeInteger(row.when) ||
          row.when < 0
        ) {
          return [];
        }
        const callsign = row.callsign.trim().slice(0, 24);
        const mission = row.mission.trim().slice(0, 80);
        const result = row.result.trim().slice(0, 80);
        if (!callsign || !mission || !result) return [];
        return [{ callsign, note: row.note.trim().slice(0, 140), mission, result, when: row.when }];
      })
      .slice(0, 12);
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
    <section class="debrief-result-group" aria-labelledby="debrief-result-title">
      <div class="debrief-group-label">01 / RESULT</div>
      <div class="report-number">AFTER-ACTION REPORT / ${d.serial}</div>
      <div class="debrief-result-heading">
        <div class="debrief-result-copy"><h1 id="debrief-result-title" class="debrief-banner" data-screen-title tabindex="-1">${win ? "DEVICE DISARMED" : "DEVICE DETONATED"}</h1>
          <div class="debrief-sub">${d.mission.codename} · SERIAL ${d.serial}</div></div>
        <div class="debrief-stamp">${icon(win ? "shield" : "wire")}<span>${win ? "CLEARED" : "FAILED"}</span></div>
      </div>
      <div class="debrief-stats" aria-label="Mission result summary">
        <div class="stat"><span>${win ? fmtClock(d.msLeft) : "00:00"}</span><small>time left</small></div>
        <div class="stat"><span>${d.strikes}/3</span><small>strikes</small></div>
        <div class="stat"><span>${d.toolCalls}</span><small>team radio calls</small></div>
        <div class="stat stat-rating debrief-grade"><span>${rating(d)}</span><small>field grade</small></div>
      </div>
    </section>`;
  board.appendChild(sheet);
  wrap.appendChild(board);

  const coaching = el("section", "coaching debrief-next-action");
  coaching.setAttribute("aria-labelledby", "debrief-next-action-title");
  coaching.innerHTML = `<div>${icon("radio")}<span><small class="debrief-action-kicker">02 / NEXT ACTION</small><h2 id="debrief-next-action-title">REVIEW THE RUN TOGETHER</h2>
    <p>Ask your agent for one strength, one improvement and the best next drill. The review uses device events only—not your private conversation.</p></span></div>`;
  const coachingActions = el("footer", "coaching-actions");
  coachingActions.setAttribute("role", "group");
  coachingActions.setAttribute("aria-label", "Review and continue");
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
  skills.setAttribute("aria-labelledby", "skills-practiced-title");
  skills.innerHTML = `<div class="skills-heading"><span class="skills-stamp-mark" aria-hidden="true"><b>FIELD</b><span>VERIFIED</span></span><div><small class="skills-kicker">TRAINING LEDGER / OBSERVED</small><h2 id="skills-practiced-title">SKILLS PRACTICED</h2></div></div>
    <div class="skill-stamp-grid" role="list">${skillLines(d, win)
      .map((s) => `<div class="skill-row skill-stamp" role="listitem"><span class="skill-medal" aria-hidden="true">✓</span><span class="skill-name">${s[0]}</span><span class="skill-note">${s[1]}</span></div>`)
      .join("")}</div>`;
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
      toolparamdescription="Short team callsign, e.g. WIRE WOLVES">
    <label for="note">AFTER-ACTION NOTE</label>
    <input id="note" name="note" maxlength="140"
      toolparamdescription="One-line after-action note for the log">
    <button type="submit" class="btn btn-primary">FILE REPORT</button>`;
  const callsignInput = form.querySelector<HTMLInputElement>("#callsign")!;
  callsignInput.value = (store.get("crosstalk.callsign") ?? "").slice(0, 24);
  const reportStatus = el("p", "report-status");
  reportStatus.setAttribute("role", "status");
  reportStatus.setAttribute("aria-live", "polite");
  const logEl = el("div", "squad-log");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const callsign = (String(fd.get("callsign") ?? "").trim() || "UNNAMED SQUAD").slice(0, 24);
    const note = String(fd.get("note") ?? "").trim().slice(0, 140);
    const report: FieldReport = {
      callsign,
      note,
      mission: d.mission.codename,
      result: win ? `disarmed, ${fmtClock(d.msLeft)} left` : "detonated",
      when: Date.now()
    };
    const all = [report, ...loadReports()].slice(0, 12);
    const persisted =
      store.set("crosstalk.reports", JSON.stringify(all)) &&
      store.set("crosstalk.callsign", callsign);
    reportStatus.textContent = persisted
      ? `Report filed for ${callsign}.`
      : "Report is visible for this session, but browser storage is unavailable.";
    paintLog(persisted ? loadReports() : all);
    const ev = e as SubmitEvent & { agentInvoked?: boolean; respondWith?(p: Promise<unknown>): void };
    if (ev.agentInvoked && typeof ev.respondWith === "function") {
      ev.respondWith(Promise.resolve(
        persisted
          ? `Field report filed for ${callsign}: "${note}" (${report.result}).`
          : `Field report accepted for ${callsign}, but browser storage is unavailable; it will not survive a reload.`
      ));
    }
  });
  const paintLog = (rows = loadReports()): void => {
    logEl.innerHTML = rows.length
      ? `<h4>SQUAD LOG</h4>` +
        rows
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
  form.appendChild(reportStatus);
  reportWrap.append(form, logEl);
  sheet.appendChild(reportWrap);

  const row = el("div", "brief-actions debrief-actions debrief-redeploy");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Redeploy or return to mission select");
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
      "button",
      "debrief-hint",
      `Tip: your agent could have checked <b>get_device_state</b> mid-mission — open AGENT KIT to see everything it can do.`
    );
    hint.type = "button";
    hint.addEventListener("click", (event) => toggleDrawer("console", event.currentTarget as HTMLElement));
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
