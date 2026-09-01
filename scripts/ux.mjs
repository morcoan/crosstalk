/** Automated interaction, hierarchy, target-size, and responsive checks. Run after `npm run build`. */
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".ttf": "font/ttf", ".png": "image/png", ".gif": "image/gif"
};
const server = createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : (req.url ?? "/").split("?")[0];
  try {
    const data = await readFile(join(DIST, path));
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("UX loopback server did not expose a TCP port");
const BASE_URL = `http://127.0.0.1:${address.port}/`;

const browser = await chromium.launch();
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
  else console.log(`  ok  ${message}`);
};

async function boot(viewport, reducedMotion = "no-preference") {
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const tools = new Map();
    Object.defineProperty(document, "modelContext", {
      value: {
        async registerTool(tool, options) {
          tools.set(tool.name, tool);
          options?.signal?.addEventListener("abort", () => {
            if (tools.get(tool.name) === tool) tools.delete(tool.name);
          });
        }
      },
      configurable: true
    });
    window.__uxCallTool = async (name, args = {}) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`UX tool is not registered: ${name}`);
      return tool.execute(args);
    };
  });
  await page.goto(BASE_URL);
  await page.waitForSelector(".mission-card");
  return { context, page };
}

async function overflow(page) {
  return page.evaluate(() => {
    window.scrollTo(1_000_000, window.scrollY);
    const horizontalTravel = window.scrollX;
    window.scrollTo(0, window.scrollY);
    return {
      horizontalTravel,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    };
  });
}

async function checkAxe(page, label) {
  const result = await new AxeBuilder({ page }).analyze();
  if (result.violations.length === 0) {
    console.log(`  ok  ${label} has no automated accessibility violations`);
    return;
  }
  for (const violation of result.violations) {
    const targets = violation.nodes.slice(0, 3).flatMap((node) => node.target).join(", ");
    failures.push(`${label}: ${violation.id} (${violation.impact ?? "unknown"}) ${targets}`);
  }
}

async function smallestVisibleTarget(page, selector) {
  return page.locator(selector).evaluateAll((els) => els
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .reduce((min, r) => Math.min(min, r.width, r.height), Infinity));
}

async function drawerVisuals(page) {
  return page.locator(".drawer").evaluate((drawer) => {
    const alpha = (value) => {
      const match = value.match(/^rgba?\(([^)]+)\)$/i);
      if (!match) return value === "transparent" ? 0 : 1;
      const channels = match[1].split(/[\s,\/]+/).filter(Boolean);
      return channels.length > 3 ? Number(channels[3]) : 1;
    };
    const luminance = (value) => {
      const match = value.match(/^rgba?\(([^)]+)\)$/i);
      if (!match) return null;
      const rgb = match[1].split(/[\s,\/]+/).filter(Boolean).slice(0, 3).map(Number);
      if (rgb.length !== 3 || rgb.some((channel) => !Number.isFinite(channel))) return null;
      const linear = rgb.map((channel) => {
        const s = channel / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const style = getComputedStyle(drawer);
    const hostStyle = getComputedStyle(drawer.closest(".drawer-host"));
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    const contrast = foreground === null || background === null
      ? 0
      : (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    return {
      panelAlpha: alpha(style.backgroundColor),
      scrimAlpha: alpha(hostStyle.backgroundColor),
      contrast
    };
  });
}

async function checkDialogFocusLoop(page, label) {
  const focusAtEdge = (edge) => page.evaluate((requestedEdge) => {
    const drawer = document.querySelector(".drawer");
    if (!drawer) return false;
    const focusable = [...drawer.querySelectorAll(
      'button:not([disabled]), a[href], summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((node) => node.getClientRects().length > 0);
    return document.activeElement === (requestedEdge === "first" ? focusable.at(0) : focusable.at(-1));
  }, edge);
  await page.keyboard.press("Shift+Tab");
  check(
    await focusAtEdge("last"),
    `${label} wraps reverse-tab focus to the final dialog control`
  );
  await page.keyboard.press("Tab");
  check(
    await focusAtEdge("first"),
    `${label} wraps forward-tab focus to the first dialog control`
  );
}

function solveWires(colors, serialOdd) {
  const count = (color) => colors.filter((value) => value === color).length;
  const last = colors.at(-1);
  if (colors.length === 3) {
    if (count("red") === 0) return 1;
    if (last === "white") return colors.length - 1;
    if (count("blue") > 1) return colors.lastIndexOf("blue");
    return 0;
  }
  if (colors.length === 4) {
    if (count("yellow") > 1 && serialOdd) return colors.lastIndexOf("yellow");
    if (count("blue") === 0) return 0;
    if (count("green") === 1) return colors.indexOf("green");
    return colors.length - 1;
  }
  if (last === "black" && !serialOdd) return 3;
  if (count("red") === 1 && count("green") > 1) return colors.indexOf("red");
  if (count("yellow") === 0) return 1;
  return 0;
}

async function solveVisibleWireBay(page) {
  const tag = String(await page.evaluate(() => window.__uxCallTool("scan_data_tag")));
  const colors = await page.locator(".wire").evaluateAll((wires) => wires.map((wire) => {
    const match = wire.getAttribute("aria-label")?.match(/^wire \d+, ([a-z]+)/i);
    if (!match) throw new Error("wire accessible name does not expose its color");
    return match[1].toLowerCase();
  }));
  const target = solveWires(colors, tag.includes("ODD"));
  await page.locator(".wire").nth(target).click();
  await page.getByRole("button", { name: "CONFIRM CUT" }).click();
}

try {
  const desktop = await boot({ width: 1440, height: 1000 });
  check(await desktop.page.locator(".mission-card").count() === 3, "three missions remain plainly selectable");
  check(await desktop.page.locator(".menu-top > .hero + .linkcard").count() === 1, "desk composition separates the field placard from the pinned agent note");
  check(await desktop.page.locator(".mission-card[data-material]").count() === 3, "each mission is filed as a distinct physical material");
  check(await desktop.page.locator(".how-col").count() === 3, "observe / communicate / commit onboarding is present");
  const fonts = await desktop.page.evaluate(async () => {
    await document.fonts.ready;
    return ["B612", "Barlow Condensed", "Caveat"].every((name) => document.fonts.check(`12px "${name}"`));
  });
  check(fonts, "all three bundled OFL typeface families load locally");
  const desktopOverflow = await overflow(desktop.page);
  check(desktopOverflow.horizontalTravel === 0 && desktopOverflow.scrollWidth === desktopOverflow.clientWidth, "desktop has exact zero horizontal overflow");
  check((await smallestVisibleTarget(desktop.page, "button")) >= 42, "desktop controls meet the 42px pointer-target floor");
  check(await desktop.page.locator("h1").count() === 1, "menu exposes one clear h1");
  await checkAxe(desktop.page, "menu");

  const manualTrigger = desktop.page.locator('[data-role="btn-manual"]:visible');
  await manualTrigger.focus();
  await manualTrigger.click();
  const manualDialog = desktop.page.getByRole("dialog", { name: /field manual/i });
  check(await manualDialog.count() === 1, "field manual is announced as a named modal dialog");
  check(await manualTrigger.getAttribute("aria-expanded") === "true", "field manual trigger exposes open state");
  await desktop.page.waitForFunction(() => document.querySelector(".drawer")?.contains(document.activeElement) === true);
  check(await desktop.page.evaluate(() => document.querySelector(".drawer")?.contains(document.activeElement) === true), "field manual moves focus inside the dialog");
  const manualVisuals = await drawerVisuals(desktop.page);
  check(manualVisuals.panelAlpha >= 0.95 && manualVisuals.contrast >= 4.5, "field manual uses an opaque, readable panel surface");
  check(manualVisuals.scrimAlpha >= 0.35, "field manual uses a visible background scrim");
  await checkDialogFocusLoop(desktop.page, "field manual");
  const manualOverflow = await desktop.page.locator(".manual-text").evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth
  }));
  check(manualOverflow.scrollWidth <= manualOverflow.clientWidth + 1, "field manual text does not require horizontal scrolling");
  await desktop.page.keyboard.press("Escape");
  check(await manualTrigger.getAttribute("aria-expanded") === "false", "Escape closes the field manual");
  check(await desktop.page.evaluate(() => document.activeElement?.getAttribute("data-role") === "btn-manual"), "closing the field manual restores trigger focus");

  const kitTrigger = desktop.page.locator('[data-role="btn-console"]:visible');
  await kitTrigger.focus();
  await kitTrigger.click();
  const kitDialog = desktop.page.getByRole("dialog", { name: /agent kit/i });
  check(await kitDialog.count() === 1, "Agent Kit is announced as a named modal dialog");
  const kitVisuals = await drawerVisuals(desktop.page);
  check(kitVisuals.panelAlpha >= 0.95 && kitVisuals.contrast >= 4.5, "Agent Kit uses an opaque, readable panel surface");
  check(kitVisuals.scrimAlpha >= 0.35, "Agent Kit uses a visible background scrim");
  await checkDialogFocusLoop(desktop.page, "Agent Kit");
  await desktop.page.locator('.console-tool[data-tool-name="consult_manual"]').click();
  check(await desktop.page.locator(".console-fields select").count() === 1, "Agent Kit converts supported schemas into labeled controls");
  check(await desktop.page.locator(".console-args").count() === 0, "Agent Kit avoids raw JSON for supported schemas");
  await desktop.page.getByRole("button", { name: "Close Agent Kit" }).click();
  check(await desktop.page.evaluate(() => document.activeElement?.getAttribute("data-role") === "btn-console"), "closing the Agent Kit restores trigger focus");

  const firstMission = desktop.page.locator(".mission-card").first();
  await desktop.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await firstMission.focus();
  const menuScrollBeforeTransition = await desktop.page.evaluate(() => window.scrollY);
  await desktop.page.keyboard.press("Enter");
  await desktop.page.waitForSelector(".btn-arm");
  await desktop.page.waitForTimeout(50);
  const transitionState = await desktop.page.evaluate(() => {
    const title = document.querySelector("[data-screen-title]");
    const rect = title?.getBoundingClientRect();
    return {
      scrollY: window.scrollY,
      titleVisible: Boolean(rect && rect.top >= 0 && rect.bottom <= innerHeight),
      titleFocused: document.activeElement === title
    };
  });
  check(
    transitionState.scrollY < menuScrollBeforeTransition && transitionState.titleVisible && transitionState.titleFocused,
    "screen transition clears stale scroll position and presents the new heading"
  );
  check(await desktop.page.locator("h1").count() === 1, "briefing exposes one clear h1");
  check(
    await desktop.page.locator(".brief-roles > .preflight-you").count() === 1 &&
      await desktop.page.locator(".brief-roles > .preflight-agent").count() === 1,
    "briefing separates human and agent ownership"
  );
  await desktop.page.locator(".btn-arm").click();
  await desktop.page.waitForSelector(".wire-bay");
  check(await desktop.page.locator("h1").count() === 1, "active mission exposes one clear h1");
  check(await desktop.page.locator(".device-chassis").count() === 1, "modules share one physical equipment chassis");
  check(await desktop.page.locator(".radio-shell + .printer-slot").count() === 1, "team radio prints through a visible paper-feed slot");
  check(await desktop.page.locator(".module-instruction").count() === 1, "live module exposes a single next-action cue");
  check(await desktop.page.locator(".feed-latest").count() === 1, "team radio promotes the latest event");
  check(await desktop.page.getByRole("navigation", { name: "Device module status and navigation" }).count() === 1, "active mission exposes named module-status navigation");
  check(await desktop.page.locator('[data-role="module-navigation-control"]').count() === 1, "module-status navigation represents every active module");
  check(await desktop.page.locator('[data-role="team-radio-ticker"][aria-hidden="true"]').count() === 1, "compact radio ticker is presentational rather than a second announcement region");
  check((await smallestVisibleTarget(desktop.page, ".wire")) >= 42, "physical wire controls remain easy to hit");
  await checkAxe(desktop.page, "active mission");
  await desktop.context.close();

  const keyboard = await boot({ width: 1280, height: 900 });
  await keyboard.page.locator(".mission-card").nth(1).click();
  await keyboard.page.locator(".btn-arm").click();
  await keyboard.page.waitForSelector(".keypad .key");
  const firstKey = keyboard.page.locator(".keypad .key").first();
  await firstKey.focus();
  await keyboard.page.keyboard.press("Enter");
  check(await keyboard.page.evaluate(() => Boolean(document.activeElement?.closest(".module-keypad"))), "keypad keeps keyboard focus in the module after rerender");
  await keyboard.context.close();

  const wayfinding = await boot({ width: 390, height: 844 });
  await wayfinding.page.locator(".mission-card").nth(1).click();
  await wayfinding.page.locator(".btn-arm").click();
  await wayfinding.page.waitForSelector('.module-card[data-role="device-module"]');
  const moduleNav = wayfinding.page.getByRole("navigation", { name: "Device module status and navigation" });
  const moduleJumps = moduleNav.locator('[data-role="module-navigation-control"]');
  const moduleCards = wayfinding.page.locator('.module-card[data-role="device-module"]');
  check(await moduleNav.count() === 1, "module-status navigation has a stable accessible name");
  check(await moduleJumps.count() === 3 && await moduleCards.count() === 3, "module-status navigation has one control per field-device module");
  const moduleContracts = await moduleJumps.evaluateAll((jumps) => jumps.every((jump, index) => {
    const controlledId = jump.getAttribute("aria-controls");
    const card = controlledId ? document.getElementById(controlledId) : null;
    return Boolean(
      card &&
      card.matches('.module-card[data-role="device-module"][tabindex="-1"]') &&
      jump.dataset.moduleIndex === String(index + 1) &&
      card.dataset.moduleIndex === jump.dataset.moduleIndex &&
      card.dataset.kind === jump.dataset.kind &&
      card.dataset.status === "armed" &&
      jump.dataset.status === "armed" &&
      /armed\. jump to module\.$/i.test(jump.getAttribute("aria-label") ?? "")
    );
  }));
  check(moduleContracts, "module navigation controls identify and control the matching armed module cards");
  check((await smallestVisibleTarget(wayfinding.page, '.module-status-jump')) >= 44, "mobile module-navigation controls meet the 44px touch-target floor");

  const lastJump = moduleJumps.last();
  const lastControlledId = await lastJump.getAttribute("aria-controls");
  const beforeModuleJump = await wayfinding.page.evaluate(() => window.scrollY);
  await lastJump.click();
  check(
    await wayfinding.page.evaluate((id) => document.activeElement?.id === id, lastControlledId),
    "module navigation transfers focus to the controlled module card"
  );
  await wayfinding.page.waitForFunction((id) => {
    const card = document.getElementById(id);
    if (!card) return false;
    const rect = card.getBoundingClientRect();
    return rect.bottom > 66 && rect.top < innerHeight;
  }, lastControlledId);
  check(
    await wayfinding.page.evaluate((before) => window.scrollY > before, beforeModuleJump),
    "module navigation scrolls an off-screen module into the mobile viewport"
  );

  const initialTicker = await wayfinding.page.evaluate(() => {
    const ticker = document.querySelector('[data-role="team-radio-ticker"]');
    const latest = document.querySelector(".feed-latest");
    const message = document.querySelector('[data-role="team-radio-ticker-message"]');
    const clock = document.querySelector('[data-role="team-radio-ticker-clock"]');
    const latestMessage = latest?.querySelector("b")?.textContent?.trim() ?? latest?.textContent?.replace(latest.querySelector(".feed-clock")?.textContent ?? "", "").trim();
    const tone = [...(ticker?.classList ?? [])].find((name) => name.startsWith("tone-"));
    const latestTone = [...(latest?.classList ?? [])].find((name) => name.startsWith("tone-"));
    return {
      hidden: ticker?.getAttribute("aria-hidden") === "true",
      live: ticker?.hasAttribute("aria-live") || ticker?.getAttribute("role") === "status",
      messageMatches: message?.textContent?.trim() === latestMessage,
      clockMatches: clock?.textContent?.trim() === latest?.querySelector(".feed-clock")?.textContent?.trim(),
      toneMatches: tone === latestTone,
      authoritativeRegions: document.querySelectorAll('.active-screen > [role="status"][aria-live]').length
    };
  });
  check(initialTicker.messageMatches && initialTicker.clockMatches && initialTicker.toneMatches, "compact radio ticker mirrors the latest feed entry and tone");
  check(initialTicker.hidden && !initialTicker.live && initialTicker.authoritativeRegions === 1, "compact radio ticker does not duplicate the authoritative live region");

  const firstJump = moduleJumps.first();
  const firstCard = moduleCards.first();
  await solveVisibleWireBay(wayfinding.page);
  await wayfinding.page.waitForFunction(() => document.querySelector('[data-role="module-navigation-control"]')?.getAttribute("data-status") === "solved");
  check(
    await firstJump.getAttribute("data-status") === "solved" &&
      await firstCard.getAttribute("data-status") === "solved" &&
      await firstJump.evaluate((node) => node.classList.contains("is-solved")) &&
      await firstCard.evaluate((node) => node.classList.contains("is-solved")),
    "solving a module updates both navigation and controlled-card state"
  );
  check(
    /cleared\. jump to module\.$/i.test(await firstJump.getAttribute("aria-label") ?? "") &&
      /cleared/i.test(await firstJump.textContent() ?? "") &&
      /cleared/i.test(await firstCard.locator(".module-status-text").textContent() ?? ""),
    "solved module state is reflected in visible and accessible labels"
  );
  const solvedTickerMatches = await wayfinding.page.evaluate(() => {
    const latest = document.querySelector(".feed-latest");
    return document.querySelector('[data-role="team-radio-ticker-message"]')?.textContent?.trim() === latest?.querySelector("b")?.textContent?.trim();
  });
  check(solvedTickerMatches, "compact radio ticker follows the latest feed after a module solve");
  const activeMobileOverflow = await overflow(wayfinding.page);
  check(activeMobileOverflow.horizontalTravel === 0 && activeMobileOverflow.scrollWidth === activeMobileOverflow.clientWidth, "active mobile module navigation does not create page overflow");
  await wayfinding.context.close();

  const defaults = await boot({ width: 1280, height: 900 });
  await defaults.page.locator(".mission-card").nth(2).click();
  await defaults.page.locator(".btn-arm").click();
  await defaults.page.waitForSelector('[data-role="signal-speaker"]');
  await defaults.page.waitForFunction(() => document.querySelector('[data-role="signal-speaker"]')?.getAttribute("data-pulse") === "idle");
  const signalOff = await defaults.page.evaluate(() => {
    const speaker = document.querySelector('[data-role="signal-speaker"]');
    const lamp = document.querySelector('.speaker-led');
    const label = document.querySelector('[data-role="pulse-label"]');
    const pulsePanel = document.querySelector('.speaker-pulse');
    const style = lamp ? getComputedStyle(lamp) : null;
    const rect = lamp?.getBoundingClientRect();
    const speakerRect = speaker?.getBoundingClientRect();
    const pulseRect = pulsePanel?.getBoundingClientRect();
    return {
      accessibleName: speaker?.getAttribute("aria-label") ?? "",
      label: label?.textContent?.trim() ?? "",
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
      pulseContained: Boolean(
        speakerRect && pulseRect &&
        pulseRect.left >= speakerRect.left &&
        pulseRect.right <= speakerRect.right + 1 &&
        pulseRect.top >= speakerRect.top &&
        pulseRect.bottom <= speakerRect.bottom + 1
      ),
      background: style?.backgroundImage ?? "",
      shadow: style?.boxShadow ?? ""
    };
  });
  await defaults.page.waitForFunction(() => document.querySelector('[data-role="signal-speaker"]')?.getAttribute("data-pulse") !== "idle", null, { timeout: 5000 });
  const signalOn = await defaults.page.evaluate(() => {
    const speaker = document.querySelector('[data-role="signal-speaker"]');
    const lamp = document.querySelector('.speaker-led');
    const label = document.querySelector('[data-role="pulse-label"]');
    const meter = document.querySelector('.speaker-grill i');
    const style = lamp ? getComputedStyle(lamp) : null;
    const meterStyle = meter ? getComputedStyle(meter) : null;
    return {
      pulse: speaker?.getAttribute("data-pulse") ?? "idle",
      label: label?.textContent?.trim() ?? "",
      background: style?.backgroundImage ?? "",
      shadow: style?.boxShadow ?? "",
      transform: style?.transform ?? "",
      meterAnimation: meterStyle?.animationName ?? "none",
      meterOpacity: Number(meterStyle?.opacity ?? 0)
    };
  });
  check(signalOff.width >= 40 && signalOff.height >= 40, "SIGNAL TX uses a large visible pulse lamp instead of a status pinprick");
  check(signalOff.pulseContained, "SIGNAL TX pulse panel stays fully visible inside the speaker housing");
  check(/short and long beep rhythm/i.test(signalOff.accessibleName) && signalOff.label === "LISTEN", "SIGNAL TX explains the visual rhythm indicator");
  check(
    signalOn.label === "BEEP" &&
      ["short", "long"].includes(signalOn.pulse) &&
      signalOn.background !== signalOff.background &&
      signalOn.shadow !== signalOff.shadow &&
      signalOn.transform !== "none",
    "SIGNAL TX pulse has an unmistakably different rendered on state"
  );
  check(signalOn.meterAnimation === "signal-meter-kick" && signalOn.meterOpacity >= 0.9, "SIGNAL TX speaker grille visibly reacts while a beep is sounding");
  await defaults.page.locator('[data-role="btn-console"]:visible').click();
  await defaults.page.locator('.console-tool[data-tool-name="set_transmitter_frequency"]').click();
  check(await defaults.page.locator('.console-fields input[type="number"]').inputValue() === "3.522", "Agent Kit provides a valid example frequency by default");
  await defaults.context.close();

  for (const width of [390, 320]) {
    const mobile = await boot({ width, height: 844 });
    const mobileOverflow = await overflow(mobile.page);
    check(mobileOverflow.horizontalTravel === 0 && mobileOverflow.scrollWidth === mobileOverflow.clientWidth, `${width}px layout has exact zero horizontal overflow`);
    check((await smallestVisibleTarget(mobile.page, "button")) >= 44, `${width}px controls meet the 44px touch-target floor`);
    const tray = mobile.page.locator('section.mission-tray[aria-labelledby="mission-tray-title"]');
    const trayViewport = tray.locator('#mission-tray-viewport[role="region"]');
    const trayControls = tray.locator('.mission-tray-controls[role="group"]');
    const trayCards = tray.locator('.mission-card[data-mission-id]');
    check(await tray.count() === 1 && await mobile.page.locator("#mission-tray-title").count() === 1, `${width}px mission tray has a programmatic heading`);
    check(
      await trayViewport.getAttribute("aria-roledescription") === "carousel" && await trayViewport.getAttribute("tabindex") === "0",
      `${width}px mission tray viewport is keyboard-focusable and identified as a carousel`
    );
    check(
      await trayControls.getByRole("button", { name: /previous/i }).getAttribute("aria-controls") === "mission-tray-viewport" &&
        await trayControls.getByRole("button", { name: /next/i }).getAttribute("aria-controls") === "mission-tray-viewport",
      `${width}px mission tray exposes explicit previous and next controls`
    );
    check(
      await tray.locator('.mission-tray-position[aria-hidden="true"]').count() === 1 &&
        await tray.locator('.mission-tray-status[role="status"][aria-live="polite"][aria-atomic="true"]').count() === 1,
      `${width}px mission tray separates visual position from its accessible status`
    );
    check(
      await trayCards.evaluateAll((cards) => cards.length === 3 && cards.every((card, index) =>
        card.id === `mission-card-${card.dataset.missionId}` &&
        new RegExp(`^Mission ${index + 1} of ${cards.length}:`, "i").test(card.getAttribute("aria-label") ?? "")
      ) && new Set(cards.map((card) => card.id)).size === cards.length),
      `${width}px mission tray cards retain unique identities and accessible mission positions`
    );
    const trayLayout = await trayViewport.evaluate((viewport) => {
      const style = getComputedStyle(viewport);
      return {
        overflowX: style.overflowX,
        snap: style.scrollSnapType,
        scrollWidth: viewport.scrollWidth,
        clientWidth: viewport.clientWidth
      };
    });
    check(
      ["auto", "scroll"].includes(trayLayout.overflowX) && trayLayout.snap.includes("x") && trayLayout.scrollWidth > trayLayout.clientWidth,
      `${width}px mission tray scrolls and snaps internally`
    );
    const trayStatus = tray.locator(".mission-tray-status");
    const trayStatusBefore = (await trayStatus.textContent())?.trim();
    const trayScrollBefore = await trayViewport.evaluate((viewport) => viewport.scrollLeft);
    await trayControls.locator(".mission-tray-next").click();
    await mobile.page.waitForFunction((before) => {
      const viewport = document.querySelector("#mission-tray-viewport");
      return Boolean(viewport && viewport.scrollLeft > before + 1);
    }, trayScrollBefore);
    const trayScrollAfter = await trayViewport.evaluate((viewport) => viewport.scrollLeft);
    const trayStatusAfter = (await trayStatus.textContent())?.trim();
    check(trayScrollAfter > trayScrollBefore && Boolean(trayStatusAfter) && trayStatusAfter !== trayStatusBefore, `${width}px next control advances the tray and announces the new position`);
    const postTrayOverflow = await overflow(mobile.page);
    check(postTrayOverflow.horizontalTravel === 0 && postTrayOverflow.scrollWidth === postTrayOverflow.clientWidth, `${width}px internal tray scrolling never creates page overflow`);
    const utility = mobile.page.locator('[data-role="btn-utility"]');
    await utility.click();
    check(await utility.getAttribute("aria-expanded") === "true", `${width}px utility menu exposes its state`);
    check(await mobile.page.locator('[data-role="btn-manual"]').isVisible(), `${width}px field manual stays discoverable`);
    await mobile.page.locator(".mission-card").first().click();
    await mobile.page.locator(".btn-arm").click();
    await mobile.page.waitForSelector(".wire-bay");
    const stickyTop = await mobile.page.locator(".devbar").evaluate((el) => Math.round(el.getBoundingClientRect().top));
    check(stickyTop >= 55 && stickyTop <= 70, `${width}px timer remains sticky beneath the header`);
    check(await mobile.page.locator('[data-role="module-navigation"]').isVisible(), `${width}px module-status navigation remains visible on an armed device`);
    check(await mobile.page.locator('[data-role="team-radio-ticker"]').isVisible(), `${width}px compact radio ticker remains visible on an armed device`);
    check((await smallestVisibleTarget(mobile.page, '.module-status-jump, .wire')) >= 44, `${width}px active-device controls meet the 44px touch-target floor`);
    const armedOverflow = await overflow(mobile.page);
    check(armedOverflow.horizontalTravel === 0 && armedOverflow.scrollWidth === armedOverflow.clientWidth, `${width}px armed-device layout has exact zero horizontal overflow`);
    await mobile.context.close();
  }

  const reduced = await boot({ width: 390, height: 844 }, "reduce");
  const motion = await reduced.page.locator(".mission-card").first().evaluate((el) => {
    const style = getComputedStyle(el);
    return { transition: style.transitionDuration, animation: style.animationDuration };
  });
  check(motion.transition === "0s" && motion.animation === "0s", "reduced-motion preference removes decorative movement");
  check(await reduced.page.locator("#mission-tray-viewport").evaluate((el) => getComputedStyle(el).scrollBehavior === "auto"), "reduced-motion preference removes smooth mission-tray scrolling");
  await reduced.context.close();

  const forced = await browser.newContext({ viewport: { width: 390, height: 844 }, forcedColors: "active" });
  const forcedPage = await forced.newPage();
  await forcedPage.goto(BASE_URL);
  await forcedPage.waitForSelector(".mission-card");
  check(await forcedPage.locator(".mission-card:visible").count() === 3, "forced-colors mode keeps every mission selectable");
  check(await forcedPage.locator(".mission-tray-nav:visible").count() === 2, "forced-colors mode keeps mission-tray navigation available");
  const forcedOverflow = await overflow(forcedPage);
  check(forcedOverflow.horizontalTravel === 0 && forcedOverflow.scrollWidth === forcedOverflow.clientWidth, "forced-colors mode preserves zero page overflow");
  await forced.close();
} finally {
  await browser.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}

if (failures.length) {
  console.error(`\nUX CHECK FAILED\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nUX CHECK PASSED — hierarchy, navigation, focus, responsiveness, and accessibility verified");
