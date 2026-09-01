import { on } from "../lib/bus";
import { isMuted, setMuted, unlock } from "../lib/audio";
import { el } from "../lib/dom";
import { webmcpHealth } from "../webmcp/context";
import { renderManualPanel } from "./manualPanel";
import { renderConsolePanel } from "./consolePanel";
import { icon } from "./presentation";

/** Header HUD: brand, WebMCP readiness, sound, manual and Agent Kit drawers. */

let appRoot: HTMLElement;
let header: HTMLElement;
let drawerHost: HTMLElement;
let openDrawer: "manual" | "console" | null = null;
let drawerTrigger: HTMLElement | null = null;
let drawerDispose: (() => void) | null = null;
let previousBodyOverflow = "";

const DRAWER_ID = "utility-drawer";
const DRAWER_TITLE_ID = "utility-drawer-title";

export function agentLinked(): boolean {
  return webmcpHealth().mode === "ready";
}

export function mountHud(root: HTMLElement): void {
  appRoot = root;
  header = el("header", "hud");
  header.setAttribute("aria-label", "CROSSTALK controls");
  header.innerHTML = `
    <span class="rail-fastener rail-fastener-a" aria-hidden="true"></span><span class="rail-fastener rail-fastener-b" aria-hidden="true"></span>
    <div class="brand" role="img" aria-label="CROSSTALK field communications unit 24">
      <span class="brand-mark" aria-hidden="true"><i></i>CT</span>
      <span class="brand-copy" aria-hidden="true"><span class="brand-name">CROSSTALK</span><span class="brand-sub">FIELD COMMS / UNIT 24</span></span>
    </div>
    <div class="hud-mobile-actions">
      <button class="badge" data-role="link-badge" aria-controls="${DRAWER_ID}" aria-expanded="false" title="Open WebMCP tools"></button>
      <button class="hud-btn hud-menu-btn" data-role="btn-utility" aria-expanded="false" aria-controls="hud-utilities" title="Open game utilities">${icon("menu")}<span>MENU</span></button>
    </div>
    <div class="hud-right" id="hud-utilities">
      <button class="badge" data-role="link-badge" aria-controls="${DRAWER_ID}" aria-expanded="false" title="Open WebMCP tools"></button>
      <button class="hud-btn tab-manual" data-role="btn-manual" aria-controls="${DRAWER_ID}" aria-expanded="false">FIELD MANUAL</button>
      <button class="hud-btn tab-agent" data-role="btn-console" aria-controls="${DRAWER_ID}" aria-expanded="false">AGENT KIT</button>
      <button class="hud-btn tab-sound" data-role="btn-sound" title="Toggle sound"></button>
    </div>`;
  root.appendChild(header);

  drawerHost = el("div", "drawer-host");
  root.appendChild(drawerHost);

  const badges = header.querySelectorAll<HTMLButtonElement>('[data-role="link-badge"]');
  const paintBadge = (): void => {
    const health = webmcpHealth();
    const ready = health.mode === "ready";
    const state =
      health.mode === "ready"
        ? {
            label: `WebMCP ready with ${health.ready} live tools. Open Agent Kit.`,
            led: "led-green",
            text: '<span class="badge-long">WEBMCP </span>READY',
            count: `${health.ready} TOOLS`
          }
        : health.mode === "connecting"
          ? {
              label: `WebMCP connecting. ${health.ready} of ${health.desired} tools ready. Open Agent Kit.`,
              led: "led-amber",
              text: "CONNECTING",
              count: health.desired ? `${health.ready}/${health.desired} TOOLS` : "PREPARING"
            }
          : health.mode === "degraded"
            ? {
                label: `WebMCP degraded. ${health.ready} of ${health.desired} tools ready and ${health.failed} failed. Open Agent Kit.`,
                led: "led-red",
                text: "DEGRADED",
                count: `${health.ready}/${health.desired} TOOLS`
              }
            : {
                label: "Solo tools ready. Open Agent Kit.",
                led: "led-amber",
                text: "SOLO READY",
                count: ""
              };
    badges.forEach((badge) => {
      badge.classList.toggle("is-linked", ready);
      badge.classList.toggle("is-degraded", health.mode === "degraded");
      badge.setAttribute("aria-label", state.label);
      badge.innerHTML = `<span class="cable-knot" aria-hidden="true"></span><span class="led ${state.led}" aria-hidden="true"></span><span class="badge-status">${state.text}</span>${state.count ? `<small>${state.count}</small>` : ""}`;
    });
  };
  paintBadge();
  on("tools", paintBadge);
  badges.forEach((badge) => badge.addEventListener("click", () => toggleDrawer("console", badge)));

  const soundBtn = header.querySelector<HTMLButtonElement>('[data-role="btn-sound"]')!;
  const paintSound = (): void => {
    const muted = isMuted();
    soundBtn.textContent = muted ? "AUDIO OFF" : "AUDIO ON";
    soundBtn.classList.toggle("is-off", muted);
    soundBtn.setAttribute("aria-pressed", String(!muted));
    soundBtn.setAttribute("aria-label", muted ? "Audio off. Turn audio on." : "Audio on. Turn audio off.");
  };
  paintSound();
  soundBtn.addEventListener("click", () => {
    setMuted(!isMuted());
    unlock();
    paintSound();
  });

  const utility = header.querySelector<HTMLButtonElement>('[data-role="btn-utility"]')!;
  utility.addEventListener("click", () => {
    const open = !header.classList.contains("is-utilities-open");
    closeUtilities();
    if (open) {
      header.classList.add("is-utilities-open");
      utility.setAttribute("aria-expanded", "true");
    }
  });
  header.querySelector<HTMLButtonElement>('[data-role="btn-manual"]')!.addEventListener("click", (event) => {
    closeUtilities();
    toggleDrawer("manual", event.currentTarget as HTMLElement);
  });
  header.querySelector<HTMLButtonElement>('[data-role="btn-console"]')!.addEventListener("click", (event) => {
    closeUtilities();
    toggleDrawer("console", event.currentTarget as HTMLElement);
  });

  drawerHost.addEventListener("pointerdown", (event) => {
    if (event.target === drawerHost) closeDrawer();
  });
  drawerHost.addEventListener("keydown", trapDrawerFocus);

  // First user gesture unlocks WebAudio.
  document.addEventListener("pointerdown", () => unlock(), { once: true });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (openDrawer) closeDrawer();
    else closeUtilities();
  });
}

export function closeUtilities(): void {
  if (!header) return;
  header.classList.remove("is-utilities-open");
  header.querySelector('[data-role="btn-utility"]')?.setAttribute("aria-expanded", "false");
}

/** Reset persistent HUD UI before a route-like screen replacement. */
export function resetHudForScreenTransition(): void {
  closeUtilities();
  closeDrawer({ restoreFocus: false });
}

export function toggleDrawer(kind: "manual" | "console", trigger?: HTMLElement): void {
  if (openDrawer === kind) {
    closeDrawer();
    return;
  }
  if (openDrawer) closeDrawer({ restoreFocus: false });

  openDrawer = kind;
  drawerTrigger = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  drawerHost.innerHTML = "";
  const panel = el("aside", "drawer");
  panel.id = DRAWER_ID;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", DRAWER_TITLE_ID);
  const head = el("div", "drawer-head");
  head.innerHTML = `<span class="drawer-tab" id="${DRAWER_TITLE_ID}">${kind === "manual" ? "FIELD MANUAL / RING BINDER" : "AGENT KIT / TOOL ROLL"}</span>`;
  const close = el("button", "hud-btn", "CLOSE ×");
  close.setAttribute("aria-label", `Close ${kind === "manual" ? "field manual" : "Agent Kit"}`);
  close.addEventListener("click", () => closeDrawer());
  head.appendChild(close);
  panel.appendChild(head);
  const body = el("div", "drawer-body");
  panel.appendChild(body);
  drawerHost.appendChild(panel);

  drawerDispose = kind === "manual" ? renderManualPanel(body) : renderConsolePanel(body);
  drawerHost.classList.add("is-open");
  setDrawerTriggerStates(kind);
  setBackgroundInert(true);
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  close.focus({ preventScroll: true });
}

export function closeDrawer(options: { restoreFocus?: boolean } = {}): void {
  if (!drawerHost || !openDrawer) return;
  const restore = options.restoreFocus !== false ? drawerTrigger : null;
  drawerDispose?.();
  drawerDispose = null;
  openDrawer = null;
  drawerHost.classList.remove("is-open");
  drawerHost.innerHTML = "";
  setBackgroundInert(false);
  document.body.style.overflow = previousBodyOverflow;
  setDrawerTriggerStates(null);
  drawerTrigger = null;
  if (restore?.isConnected) restore.focus({ preventScroll: true });
}

function setDrawerTriggerStates(kind: "manual" | "console" | null): void {
  header.querySelectorAll<HTMLElement>('[data-role="btn-manual"]').forEach((node) => {
    node.setAttribute("aria-expanded", String(kind === "manual"));
  });
  header.querySelectorAll<HTMLElement>('[data-role="btn-console"], [data-role="link-badge"]').forEach((node) => {
    node.setAttribute("aria-expanded", String(kind === "console"));
  });
}

function setBackgroundInert(inert: boolean): void {
  header.inert = inert;
  const screen = appRoot.querySelector<HTMLElement>("#screen-host");
  if (screen) screen.inert = inert;
}

function trapDrawerFocus(event: KeyboardEvent): void {
  if (event.key !== "Tab" || !openDrawer) return;
  const focusable = [...drawerHost.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((node) => node.getClientRects().length > 0);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
