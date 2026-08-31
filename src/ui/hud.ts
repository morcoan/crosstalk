import { on } from "../lib/bus";
import { isMuted, setMuted, unlock } from "../lib/audio";
import { el } from "../lib/dom";
import { liveTools, webmcpAvailable } from "../webmcp/context";
import { renderManualPanel } from "./manualPanel";
import { renderConsolePanel } from "./consolePanel";
import { icon } from "./presentation";

/** Header HUD: brand, agent-link badge, sound toggle, manual + tool console drawers. */

let drawerHost: HTMLElement;
let openDrawer: "manual" | "console" | null = null;

export function agentLinked(): boolean {
  return webmcpAvailable();
}

export function mountHud(root: HTMLElement): void {
  const header = el("header", "hud");
  header.innerHTML = `
    <div class="brand">
      <span class="brand-mark">CT</span>
      <span><span class="brand-name">CROSSTALK</span><span class="brand-sub">CO-OP DEFUSAL UNIT</span></span>
    </div>
    <div class="hud-mobile-actions">
      <button class="badge" data-role="link-badge" title="Agent connection and live tools"></button>
      <button class="hud-btn hud-menu-btn" data-role="btn-utility" aria-expanded="false" title="Open game utilities">${icon("menu")}<span>MENU</span></button>
    </div>
    <div class="hud-right">
      <button class="hud-btn" data-role="btn-manual" title="Open the field manual">FIELD MANUAL</button>
      <button class="hud-btn" data-role="btn-console" title="Inspect the agent's live equipment">AGENT KIT</button>
      <button class="hud-btn" data-role="btn-sound" title="Toggle sound"></button>
    </div>`;
  root.appendChild(header);

  drawerHost = el("div", "drawer-host");
  root.appendChild(drawerHost);

  const badge = header.querySelector<HTMLElement>('[data-role="link-badge"]')!;
  const paintBadge = (): void => {
    const okay = webmcpAvailable();
    const count = liveTools().length;
    badge.classList.toggle("is-linked", okay);
    badge.innerHTML = okay
      ? `<span class="led led-green"></span><span>AGENT READY</span><small>${count} LIVE</small>`
      : `<span class="led led-amber"></span><span>SOLO MODE</span>`;
  };
  paintBadge();
  on("tools", paintBadge);
  badge.addEventListener("click", () => toggleDrawer("console"));

  const soundBtn = header.querySelector<HTMLElement>('[data-role="btn-sound"]')!;
  const paintSound = (): void => {
    soundBtn.textContent = isMuted() ? "SOUND: OFF" : "SOUND: ON";
    soundBtn.classList.toggle("is-off", isMuted());
  };
  paintSound();
  soundBtn.addEventListener("click", () => {
    setMuted(!isMuted());
    unlock();
    paintSound();
  });

  const utility = header.querySelector<HTMLElement>('[data-role="btn-utility"]')!;
  utility.addEventListener("click", () => {
    const open = header.classList.toggle("is-utilities-open");
    utility.setAttribute("aria-expanded", String(open));
  });
  header.querySelector('[data-role="btn-manual"]')!.addEventListener("click", () => {
    header.classList.remove("is-utilities-open");
    toggleDrawer("manual");
  });
  header.querySelector('[data-role="btn-console"]')!.addEventListener("click", () => {
    header.classList.remove("is-utilities-open");
    toggleDrawer("console");
  });

  // First user gesture unlocks WebAudio.
  document.addEventListener("pointerdown", () => unlock(), { once: true });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });
}

export function toggleDrawer(kind: "manual" | "console"): void {
  if (openDrawer === kind) {
    closeDrawer();
    return;
  }
  openDrawer = kind;
  drawerHost.innerHTML = "";
  const panel = el("aside", "drawer");
  const head = el("div", "drawer-head");
  head.innerHTML = `<span>${kind === "manual" ? "FIELD MANUAL" : "AGENT EQUIPMENT"}</span>`;
  const close = el("button", "hud-btn", "CLOSE ×");
  close.addEventListener("click", closeDrawer);
  head.appendChild(close);
  panel.appendChild(head);
  const body = el("div", "drawer-body");
  panel.appendChild(body);
  drawerHost.appendChild(panel);
  if (kind === "manual") renderManualPanel(body);
  else renderConsolePanel(body);
  drawerHost.classList.add("is-open");
}

export function closeDrawer(): void {
  openDrawer = null;
  drawerHost.classList.remove("is-open");
  drawerHost.innerHTML = "";
}
