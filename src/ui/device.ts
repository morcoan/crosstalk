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

export function renderDevice(root: HTMLElement): void {
  unsubs.forEach((u) => u());
  unsubs = [];

  const d = game.device;
  if (!d) return;

  const wrap = el("div", "screen active-screen");
  wrap.innerHTML = `<div class="bench-shadow device-shadow" aria-hidden="true"></div>`;

  /* -------- top bar -------- */
  const top = el("div", "devbar");
  top.innerHTML = `
    <div class="devbar-left">
      <div class="dev-kicker">ACTIVE DEVICE</div>
      <div class="dev-codename">${d.mission.codename}</div>
      <div class="dev-serial" title="Machine-readable only — your agent can scan_data_tag">
        DATA TAG <span class="serial-smudge">▮▪▮ RFID ▮▪▮</span>
      </div>
    </div>
    <div class="dev-clock"><span>TIME REMAINING</span><div class="dev-timer" data-role="timer">${fmtClock(d.msLeft)}</div></div>
    <div class="dev-strike-bank"><span>STRIKES</span><div class="dev-strikes" data-role="strikes"></div></div>`;
  wrap.appendChild(top);

  /* -------- device + feed layout -------- */
  const layout = el("div", "dev-layout");
  const chassis = el("section", `device-chassis chassis-mods-${d.modules.length}`);
  chassis.innerHTML = `<div class="chassis-stencil">CT–${d.mission.id.toUpperCase()} / DO NOT OPEN</div>
    <span class="chassis-handle handle-left"></span><span class="chassis-handle handle-right"></span>
    <span class="chassis-cable cable-a"></span><span class="chassis-cable cable-b"></span>
    <span class="chassis-rivet rivet-a"></span><span class="chassis-rivet rivet-b"></span>
    <span class="chassis-rivet rivet-c"></span><span class="chassis-rivet rivet-d"></span>`;
  const grid = el("div", `module-grid mods-${d.modules.length}`);
  const bodies = new Map<GameModule, HTMLElement>();
  const cards = new Map<GameModule, HTMLElement>();

  d.modules.forEach((mod) => {
    const card = el("div", `module-card module-${mod.kind}`);
    card.dataset.material = mod.kind;
    const head = el("div", "module-head");
    head.innerHTML = `<span class="module-label">${mod.label}</span><span class="module-status"><span class="module-status-text">ARMED</span><span class="module-led"></span></span>`;
    const roles = el("div", "module-roles");
    const meta = modulePresentation[mod.kind];
    roles.innerHTML = `<div>${icon("eye")}<span><b>YOU</b>${meta.human}</span></div><div>${icon("wrench")}<span><b>AGENT</b>${meta.agent}</span></div>`;
    const instruction = el("div", "module-instruction", `${meta.instruction}`);
    const body = el("div", "module-body");
    card.append(head, roles, instruction, body);
    grid.appendChild(card);
    bodies.set(mod, body);
    cards.set(mod, card);
    mod.render(body);
  });
  chassis.appendChild(grid);
  layout.appendChild(chassis);

  const side = el("aside", "feedpane");
  side.innerHTML = `<div class="radio-shell"><span class="radio-antenna"></span><span class="radio-dial"></span>
    <div class="radio-grille">${"<i></i>".repeat(18)}</div><div class="feed-head">${icon("radio")}<span>TEAM RADIO<small>FIELD TRANSCEIVER / RX–24</small></span></div></div>
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
  root.appendChild(wrap);

  const timerEl = top.querySelector<HTMLElement>('[data-role="timer"]')!;
  const strikesEl = top.querySelector<HTMLElement>('[data-role="strikes"]')!;

  const paintChrome = (): void => {
    timerEl.textContent = fmtClock(d.msLeft);
    timerEl.classList.toggle("is-low", d.msLeft <= 60_000);
    strikesEl.innerHTML = [0, 1, 2]
      .map((i) => `<span class="strike-led${i < d.strikes ? " is-hit" : ""}">✕</span>`)
      .join("");
    d.modules.forEach((mod) => {
      const card = cards.get(mod);
      card?.classList.toggle("is-solved", mod.status === "solved");
      const status = card?.querySelector<HTMLElement>(".module-status-text");
      if (status) status.textContent = mod.status === "solved" ? "CLEARED ✓" : "ARMED";
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
    feedList.innerHTML = entries
      .slice(-60)
      .map((f) => `<div class="feed-row tone-${f.tone}"><span class="feed-clock">${f.clock}</span>${esc(f.text)}</div>`)
      .join("");
    feedList.scrollTop = feedList.scrollHeight;
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
