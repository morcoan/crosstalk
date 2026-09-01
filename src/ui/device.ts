import { el, esc } from "../lib/dom";
import { on } from "../lib/bus";
import { dirtyModules, fmtClock, game } from "../game/state";
import type { GameModule } from "../game/types";
import { icon, modulePresentation } from "./presentation";

/**
 * The active-device screen: countdown, strike LEDs, serial smudge, one card per
 * module, and the live ACTIVITY FEED where every agent tool call is narrated —
 * the human always sees what their invisible teammate is doing.
 */

let unsubs: (() => void)[] = [];

export function disposeDeviceUi(): void {
  unsubs.forEach((unsubscribe) => unsubscribe());
  unsubs = [];
}

export function renderDevice(root: HTMLElement): void {
  disposeDeviceUi();

  const d = game.device;
  if (!d) return;

  const wrap = el("div", "screen active-screen");
  wrap.innerHTML = `<div class="bench-shadow device-shadow" aria-hidden="true"></div>`;

  /* -------- top bar -------- */
  const top = el("div", "devbar");
  top.innerHTML = `
    <div class="devbar-left">
      <div class="dev-kicker">ACTIVE DEVICE</div>
      <h1 class="dev-codename" data-screen-title tabindex="-1">${d.mission.codename}</h1>
      <div class="dev-serial" title="Machine-readable only — your agent can scan_data_tag">
        DATA TAG <span class="serial-smudge" aria-hidden="true">▮▪▮ RFID ▮▪▮</span>
      </div>
    </div>
    <div class="dev-clock"><span>TIME REMAINING</span><div class="dev-timer" data-role="timer">${fmtClock(d.msLeft)}</div></div>
    <div class="dev-strike-bank"><span>STRIKES</span><div class="dev-strikes" data-role="strikes" role="img"></div></div>`;
  wrap.appendChild(top);

  /* -------- module wayfinding + compact radio -------- */
  const moduleNav = el("nav", "module-status-nav");
  moduleNav.setAttribute("aria-label", "Device module status and navigation");
  moduleNav.dataset.role = "module-navigation";
  moduleNav.style.setProperty("--module-count", String(d.modules.length));
  const moduleNavLabel = el("span", "module-status-nav-label", "MODULES");
  moduleNavLabel.setAttribute("aria-hidden", "true");
  const moduleNavList = el("div", "module-status-nav-list");
  moduleNav.append(moduleNavLabel, moduleNavList);

  const radioTicker = el("div", "team-radio-ticker");
  radioTicker.dataset.role = "team-radio-ticker";
  // The authoritative announcement remains the existing liveStatus region.
  radioTicker.setAttribute("aria-hidden", "true");
  const tickerLabel = el("span", "team-radio-ticker-label", "TEAM RADIO");
  const tickerClock = el("span", "team-radio-ticker-clock", "--:--");
  tickerClock.dataset.role = "team-radio-ticker-clock";
  const tickerMessage = el("span", "team-radio-ticker-message", "Radio quiet. Brief your agent and begin the handoff.");
  tickerMessage.dataset.role = "team-radio-ticker-message";
  radioTicker.append(tickerLabel, tickerClock, tickerMessage);
  top.append(moduleNav, radioTicker);

  /* -------- device + feed layout -------- */
  const layout = el("div", "dev-layout");
  const chassis = el("section", `device-chassis chassis-mods-${d.modules.length}`);
  chassis.setAttribute("aria-label", `${d.mission.codename} device modules`);
  chassis.innerHTML = `<div class="chassis-stencil">CT–${d.mission.id.toUpperCase()} / DO NOT OPEN</div>
    <span class="chassis-handle handle-left"></span><span class="chassis-handle handle-right"></span>
    <span class="chassis-cable cable-a"></span><span class="chassis-cable cable-b"></span>
    <span class="chassis-rivet rivet-a"></span><span class="chassis-rivet rivet-b"></span>
    <span class="chassis-rivet rivet-c"></span><span class="chassis-rivet rivet-d"></span>`;
  const grid = el("div", `module-grid mods-${d.modules.length}`);
  const bodies = new Map<GameModule, HTMLElement>();
  const cards = new Map<GameModule, HTMLElement>();
  const moduleJumps = new Map<GameModule, HTMLButtonElement>();

  d.modules.forEach((mod, index) => {
    const moduleAnchorId = `device-module-${d.mission.id}-${index + 1}-${mod.kind}`;
    const titleId = `module-${mod.kind}-${index}-title`;
    const instructionId = `module-${mod.kind}-${index}-instruction`;
    const card = el("section", `module-card module-${mod.kind}`);
    card.id = moduleAnchorId;
    card.tabIndex = -1;
    card.setAttribute("aria-labelledby", titleId);
    card.setAttribute("aria-describedby", instructionId);
    card.dataset.role = "device-module";
    card.dataset.kind = mod.kind;
    card.dataset.status = mod.status;
    card.dataset.moduleIndex = String(index + 1);
    card.dataset.material = mod.kind;
    const head = el("div", "module-head");
    head.innerHTML = `<h2 class="module-label" id="${titleId}">${mod.label}</h2><span class="module-status"><span class="module-status-text">ARMED</span><span class="module-led" aria-hidden="true"></span></span>`;
    const roles = el("div", "module-roles");
    const meta = modulePresentation[mod.kind];
    roles.innerHTML = `<div>${icon("eye")}<span><b>YOU</b> ${meta.human}</span></div><div>${icon("wrench")}<span><b>AGENT</b> ${meta.agent}</span></div>`;
    const instruction = el("div", "module-instruction", `${meta.instruction}`);
    instruction.id = instructionId;
    const body = el("div", "module-body");
    card.append(head, roles, instruction, body);
    grid.appendChild(card);
    bodies.set(mod, body);
    cards.set(mod, card);
    mod.render(body);

    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "module-status-jump";
    jump.dataset.role = "module-navigation-control";
    jump.dataset.kind = mod.kind;
    jump.dataset.status = mod.status;
    jump.dataset.moduleIndex = String(index + 1);
    jump.setAttribute("aria-controls", moduleAnchorId);
    jump.innerHTML = `<span class="module-status-jump-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><span class="module-status-jump-label">${esc(mod.label)}</span><span class="module-status-jump-state">ARMED</span>`;
    jump.setAttribute("aria-label", `${mod.label}: armed. Jump to module.`);
    jump.addEventListener("click", () => {
      const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      card.focus({ preventScroll: true });
    });
    moduleNavList.appendChild(jump);
    moduleJumps.set(mod, jump);
  });
  chassis.appendChild(grid);
  layout.appendChild(chassis);

  const side = el("aside", "feedpane");
  side.setAttribute("aria-labelledby", "team-radio-title");
  side.innerHTML = `<div class="radio-shell"><span class="radio-antenna"></span><span class="radio-dial"></span>
    <div class="radio-grille">${"<i></i>".repeat(18)}</div><div class="feed-head">${icon("radio")}<div class="feed-title"><h2 id="team-radio-title">TEAM RADIO</h2><small>FIELD TRANSCEIVER / RX–24</small></div></div></div>
    <div class="printer-slot"><span>PAPER FEED</span></div>`;
  const feedLatest = el("div", "feed-latest");
  const feedHistory = document.createElement("details");
  feedHistory.className = "feed-history";
  feedHistory.open = true;
  feedHistory.innerHTML = `<summary>TRANSMISSION HISTORY</summary>`;
  const feedList = el("div", "feed-list");
  feedHistory.appendChild(feedList);
  side.append(feedLatest, feedHistory);
  layout.appendChild(side);
  wrap.appendChild(layout);
  const liveStatus = el("div", "sr-only");
  liveStatus.setAttribute("role", "status");
  liveStatus.setAttribute("aria-live", "polite");
  liveStatus.setAttribute("aria-atomic", "true");
  wrap.appendChild(liveStatus);
  root.appendChild(wrap);

  const timerEl = top.querySelector<HTMLElement>('[data-role="timer"]')!;
  const strikesEl = top.querySelector<HTMLElement>('[data-role="strikes"]')!;

  const paintChrome = (): void => {
    timerEl.textContent = fmtClock(d.msLeft);
    timerEl.classList.toggle("is-low", d.msLeft <= 60_000);
    timerEl.setAttribute("aria-label", `${fmtClock(d.msLeft)} remaining`);
    strikesEl.setAttribute("aria-label", `${d.strikes} of 3 strikes`);
    strikesEl.innerHTML = [0, 1, 2]
      .map((i) => `<span class="strike-led${i < d.strikes ? " is-hit" : ""}">✕</span>`)
      .join("");
    d.modules.forEach((mod) => {
      const card = cards.get(mod);
      card?.classList.toggle("is-solved", mod.status === "solved");
      if (card) card.dataset.status = mod.status;
      const status = card?.querySelector<HTMLElement>(".module-status-text");
      if (status) status.textContent = mod.status === "solved" ? "CLEARED ✓" : "ARMED";
      const jump = moduleJumps.get(mod);
      if (jump) {
        const solved = mod.status === "solved";
        jump.classList.toggle("is-solved", solved);
        jump.dataset.status = mod.status;
        jump.querySelector<HTMLElement>(".module-status-jump-state")!.textContent = solved ? "CLEARED ✓" : "ARMED";
        jump.setAttribute("aria-label", `${mod.label}: ${solved ? "cleared" : "armed"}. Jump to module.`);
      }
    });
  };

  const paintDirty = (): void => {
    for (const mod of [...dirtyModules]) {
      const body = bodies.get(mod);
      if (body) mod.render(body);
      dirtyModules.delete(mod);
    }
  };

  const paintFeed = (): void => {
    const entries = game.feed.slice(-60);
    const latest = entries.at(-1);
    feedLatest.className = `feed-latest${latest ? ` tone-${latest.tone}` : ""}`;
    feedLatest.innerHTML = latest
      ? `<span class="feed-clock">${latest.clock}</span><b>${esc(latest.text)}</b>`
      : `<span>Radio quiet. Brief your agent and begin the handoff.</span>`;
    radioTicker.className = `team-radio-ticker${latest ? ` tone-${latest.tone}` : ""}`;
    tickerClock.textContent = latest?.clock ?? "--:--";
    tickerMessage.textContent = latest?.text ?? "Radio quiet. Brief your agent and begin the handoff.";
    feedList.innerHTML = entries
      .slice(-60)
      .map((f) => `<div class="feed-row tone-${f.tone}"><span class="feed-clock">${f.clock}</span>${esc(f.text)}</div>`)
      .join("");
    feedList.scrollTop = feedList.scrollHeight;
    if (latest && liveStatus.textContent !== latest.text) liveStatus.textContent = latest.text;
  };

  paintChrome();
  paintFeed();
  unsubs.push(
    on("state", () => {
      paintChrome();
      paintDirty();
    }),
    on("feed", paintFeed)
  );
}
