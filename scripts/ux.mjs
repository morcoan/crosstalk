/** Automated interaction, hierarchy, target-size, and responsive checks. Run after `npm run build`. */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
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
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
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
  check(await desktop.page.locator(".how-col").count() === 3, "observe / communicate / commit onboarding is present");
  check((await overflow(desktop.page)) <= 1, "desktop has no horizontal overflow");
  check((await smallestVisibleTarget(desktop.page, "button")) >= 42, "desktop controls meet the 42px pointer-target floor");

  const firstMission = desktop.page.locator(".mission-card").first();
  await firstMission.focus();
  await desktop.page.keyboard.press("Enter");
  await desktop.page.waitForSelector(".btn-arm");
  check(await desktop.page.locator(".brief-roles > div").count() === 2, "briefing separates human and agent ownership");
  await desktop.page.locator(".btn-arm").click();
  await desktop.page.waitForSelector(".wire-bay");
  check(await desktop.page.locator(".module-instruction").count() === 1, "live module exposes a single next-action cue");
  check(await desktop.page.locator(".feed-latest").count() === 1, "team radio promotes the latest event");
  check((await smallestVisibleTarget(desktop.page, ".wire")) >= 42, "physical wire controls remain easy to hit");
  await desktop.context.close();

  for (const width of [390, 320]) {
    const mobile = await boot({ width, height: 844 });
    check((await overflow(mobile.page)) <= 1, `${width}px layout has no horizontal overflow`);
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
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\nUX CHECK FAILED\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nUX CHECK PASSED — hierarchy, interaction, responsiveness, and motion verified");
