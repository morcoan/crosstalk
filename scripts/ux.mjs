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
await new Promise((resolve) => server.listen(4578, "127.0.0.1", resolve));

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
    Object.defineProperty(document, "modelContext", {
      value: { registerTool() {} }, configurable: true
    });
  });
  await page.goto("http://127.0.0.1:4578/");
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
  const manualOverflow = await desktop.page.locator(".manual-text").evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth
  }));
  check(manualOverflow.scrollWidth <= manualOverflow.clientWidth + 1, "field manual text does not require horizontal scrolling");
  await desktop.page.keyboard.press("Escape");
  check(await manualTrigger.getAttribute("aria-expanded") === "false", "Escape closes the field manual");
  check(await desktop.page.evaluate(() => document.activeElement?.getAttribute("data-role") === "btn-manual"), "closing the field manual restores trigger focus");

  const kitTrigger = desktop.page.locator('[data-role="btn-console"]:visible');
  await kitTrigger.click();
  await desktop.page.locator('.console-tool[data-tool-name="consult_manual"]').click();
  check(await desktop.page.locator(".console-fields select").count() === 1, "Agent Kit converts supported schemas into labeled controls");
  check(await desktop.page.locator(".console-args").count() === 0, "Agent Kit avoids raw JSON for supported schemas");
  await desktop.page.getByRole("button", { name: "Close Agent Kit" }).click();

  const firstMission = desktop.page.locator(".mission-card").first();
  await desktop.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await firstMission.focus();
  await desktop.page.keyboard.press("Enter");
  await desktop.page.waitForSelector(".btn-arm");
  await desktop.page.waitForTimeout(50);
  check(await desktop.page.evaluate(() => window.scrollY === 0), "screen transition clears stale scroll position");
  check(await desktop.page.locator("h1").count() === 1, "briefing exposes one clear h1");
  check(await desktop.page.locator(".brief-roles > div").count() === 2, "briefing separates human and agent ownership");
  await desktop.page.locator(".btn-arm").click();
  await desktop.page.waitForSelector(".wire-bay");
  check(await desktop.page.locator("h1").count() === 1, "active mission exposes one clear h1");
  check(await desktop.page.locator(".device-chassis").count() === 1, "modules share one physical equipment chassis");
  check(await desktop.page.locator(".radio-shell + .printer-slot").count() === 1, "team radio prints through a visible paper-feed slot");
  check(await desktop.page.locator(".module-instruction").count() === 1, "live module exposes a single next-action cue");
  check(await desktop.page.locator(".feed-latest").count() === 1, "team radio promotes the latest event");
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

  const defaults = await boot({ width: 1280, height: 900 });
  await defaults.page.locator(".mission-card").nth(2).click();
  await defaults.page.locator(".btn-arm").click();
  await defaults.page.locator('[data-role="btn-console"]:visible').click();
  await defaults.page.locator('.console-tool[data-tool-name="set_transmitter_frequency"]').click();
  check(await defaults.page.locator('.console-fields input[type="number"]').inputValue() === "3.522", "Agent Kit provides a valid example frequency by default");
  await defaults.context.close();

  for (const width of [390, 320]) {
    const mobile = await boot({ width, height: 844 });
    const mobileOverflow = await overflow(mobile.page);
    check(mobileOverflow.horizontalTravel === 0 && mobileOverflow.scrollWidth === mobileOverflow.clientWidth, `${width}px layout has exact zero horizontal overflow`);
    check((await smallestVisibleTarget(mobile.page, "button")) >= 44, `${width}px controls meet the 44px touch-target floor`);
    const utility = mobile.page.locator('[data-role="btn-utility"]');
    await utility.click();
    check(await utility.getAttribute("aria-expanded") === "true", `${width}px utility menu exposes its state`);
    check(await mobile.page.locator('[data-role="btn-manual"]').isVisible(), `${width}px field manual stays discoverable`);
    await mobile.page.locator(".mission-card").first().click();
    await mobile.page.locator(".btn-arm").click();
    await mobile.page.waitForSelector(".wire-bay");
    const stickyTop = await mobile.page.locator(".devbar").evaluate((el) => Math.round(el.getBoundingClientRect().top));
    check(stickyTop >= 55 && stickyTop <= 70, `${width}px timer remains sticky beneath the header`);
    await mobile.context.close();
  }

  const reduced = await boot({ width: 390, height: 844 }, "reduce");
  const motion = await reduced.page.locator(".mission-card").first().evaluate((el) => {
    const style = getComputedStyle(el);
    return { transition: style.transitionDuration, animation: style.animationDuration };
  });
  check(motion.transition === "0s" && motion.animation === "0s", "reduced-motion preference removes decorative movement");
  await reduced.context.close();

  const forced = await browser.newContext({ viewport: { width: 390, height: 844 }, forcedColors: "active" });
  const forcedPage = await forced.newPage();
  await forcedPage.goto("http://127.0.0.1:4578/");
  await forcedPage.waitForSelector(".mission-card");
  check(await forcedPage.locator(".mission-card:visible").count() === 3, "forced-colors mode keeps every mission selectable");
  await forced.close();
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\nUX CHECK FAILED\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nUX CHECK PASSED — hierarchy, interaction, responsiveness, and motion verified");
