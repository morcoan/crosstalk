import { el, esc } from "../lib/dom";
import { on } from "../lib/bus";
import { dirtyModules, fmtClock, game } from "../game/state";
import type { GameModule } from "../game/types";

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

  /* -------- top bar -------- */
  const top = el("div", "devbar");
  top.innerHTML = `
    <div class="devbar-left">
      <div class="dev-codename">${d.mission.codename}</div>
      <div class="dev-serial" title="Machine-readable only — your agent can scan_data_tag">
        SERIAL <span class="serial-smudge">▮▪▮ RFID ▮▪▮</span>
      </div>
    </div>
    <div class="dev-timer" data-role="timer">${fmtClock(d.msLeft)}</div>
    <div class="dev-strikes" data-role="strikes"></div>`;
  wrap.appendChild(top);

  /* -------- device + feed layout -------- */
  const layout = el("div", "dev-layout");
  const grid = el("div", `module-grid mods-${d.modules.length}`);
  const bodies = new Map<GameModule, HTMLElement>();
  const cards = new Map<GameModule, HTMLElement>();

  d.modules.forEach((mod) => {
    const card = el("div", "module-card");
    const head = el("div", "module-head");
    head.innerHTML = `<span class="module-label">${mod.label}</span><span class="module-led"></span>`;
    const body = el("div", "module-body");
    card.append(head, body);
    grid.appendChild(card);
    bodies.set(mod, body);
    cards.set(mod, card);
    mod.render(body);
  });
  layout.appendChild(grid);

  const side = el("aside", "feedpane");
  side.innerHTML = `<div class="feed-head">ACTIVITY FEED <span class="feed-sub">everything your agent does shows up here</span></div>`;
  const feedList = el("div", "feed-list");
  side.appendChild(feedList);
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
      cards.get(mod)?.classList.toggle("is-solved", mod.status === "solved");
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
    feedList.innerHTML = game.feed
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
