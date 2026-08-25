import { on } from "../lib/bus";
import { isMuted, setMuted, unlock } from "../lib/audio";
import { el } from "../lib/dom";
import { liveTools, webmcpAvailable } from "../webmcp/context";
import { renderManualPanel } from "./manualPanel";
import { renderConsolePanel } from "./consolePanel";

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
      <span class="brand-mark">⧉</span>
      <span class="brand-name">CROSSTALK</span>
      <span class="brand-sub">human ✕ agent defusal</span>
    </div>
    <div class="hud-right">
      <button class="badge" data-role="link-badge" title="WebMCP agent link status"></button>
      <button class="hud-btn" data-role="btn-manual" title="The printed technical manual (solo mode)">MANUAL</button>
      <button class="hud-btn" data-role="btn-console" title="Inspect and invoke the live WebMCP tools">TOOLS</button>
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
      ? `<span class="led led-green"></span> AGENT LINK · ${count} TOOL${count === 1 ? "" : "S"}`
      : `<span class="led led-amber"></span> NO AGENT LINK`;
  };
  paintBadge();
  on("tools", paintBadge);
  badge.addEventListener("click", () => toggleDrawer("console"));

  const soundBtn = header.querySelector<HTMLElement>('[data-role="btn-sound"]')!;
  const paintSound = (): void => {
    soundBtn.textContent = isMuted() ? "SOUND OFF" : "SOUND ON";
    soundBtn.classList.toggle("is-off", isMuted());
  };
  paintSound();
  soundBtn.addEventListener("click", () => {
    setMuted(!isMuted());
    unlock();
    paintSound();
  });

  header.querySelector('[data-role="btn-manual"]')!.addEventListener("click", () => toggleDrawer("manual"));
  header.querySelector('[data-role="btn-console"]')!.addEventListener("click", () => toggleDrawer("console"));

  // First user gesture unlocks WebAudio.
  document.addEventListener("pointerdown", () => unlock(), { once: true });
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
  head.innerHTML = `<span>${kind === "manual" ? "TECHNICAL MANUAL — PRINT COPY" : "WEBMCP TOOL CONSOLE"}</span>`;
  const close = el("button", "hud-btn", "CLOSE ✕");
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
