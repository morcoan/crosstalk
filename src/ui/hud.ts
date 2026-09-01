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
    <span class="rail-fastener rail-fastener-a"></span><span class="rail-fastener rail-fastener-b"></span>
    <div class="brand">
      <span class="brand-mark"><i></i>CT</span>
      <span class="brand-copy"><span class="brand-name">CROSSTALK</span><span class="brand-sub">FIELD COMMS / UNIT 24</span></span>
    </div>
    <div class="hud-mobile-actions">
      <button class="badge" data-role="link-badge" title="Agent connection and live tools"></button>
      <button class="hud-btn hud-menu-btn" data-role="btn-utility" aria-expanded="false" title="Open game utilities">${icon("menu")}<span>MENU</span></button>
    </div>
    <div class="hud-right">
      <button class="badge" data-role="link-badge" title="Agent connection and live tools"></button>
      <button class="hud-btn tab-manual" data-role="btn-manual" title="Open the field manual"><small>A</small> FIELD MANUAL</button>
      <button class="hud-btn tab-agent" data-role="btn-console" title="Inspect the agent's live equipment"><small>B</small> AGENT KIT</button>
      <button class="hud-btn tab-sound" data-role="btn-sound" title="Toggle sound"></button>
    </div>`;
  root.appendChild(header);

  drawerHost = el("div", "drawer-host");
  root.appendChild(drawerHost);

  const badges = header.querySelectorAll<HTMLElement>('[data-role="link-badge"]');
  const paintBadge = (): void => {
    const okay = webmcpAvailable();
    const count = liveTools().length;
    badges.forEach((badge) => {
      badge.classList.toggle("is-linked", okay);
      badge.innerHTML = okay
        ? `<span class="cable-knot"></span><span class="led led-green"></span><span>LINE OPEN</span><small>${count} TOOLS</small>`
        : `<span class="cable-knot"></span><span class="led led-amber"></span><span>SOLO LINE</span>`;
    });
  };
  paintBadge();
  on("tools", paintBadge);
  badges.forEach((badge) => badge.addEventListener("click", () => toggleDrawer("console")));

  const soundBtn = header.querySelector<HTMLElement>('[data-role="btn-sound"]')!;
  const paintSound = (): void => {
    soundBtn.innerHTML = `<small>C</small> ${isMuted() ? "AUDIO OFF" : "AUDIO ON"}`;
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
  head.innerHTML = `<span class="drawer-tab">${kind === "manual" ? "FIELD MANUAL / RING BINDER" : "AGENT KIT / TOOL ROLL"}</span>`;
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
