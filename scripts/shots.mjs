/** Capture review screenshots of every screen. Run after `npm run build`. */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ttf": "font/ttf" };
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
await new Promise((r) => server.listen(4574, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
    }
  });
  window.__callTool = async (name, args = {}) => tools.get(name).execute(args);
});

await page.goto("http://localhost:4574/");
await page.waitForSelector(".mission-card");
await page.screenshot({ path: "scripts/shots/menu.png", fullPage: true });

await page.click(".mission-card:nth-child(3)");
await page.waitForSelector(".btn-arm");
await page.screenshot({ path: "scripts/shots/briefing.png" });

await page.click(".btn-arm");
await page.waitForSelector(".module-grid");
// Capture the real illuminated pulse so the README demonstrates the muted-play cue.
await page.waitForSelector('.speaker-led.is-on', { timeout: 5000 });
await page.screenshot({ path: "scripts/shots/mission3.png", fullPage: true });

// manual drawer
await page.click('[data-role="btn-manual"]');
await page.waitForSelector(".manual-text");
await page.waitForTimeout(250);
await page.screenshot({ path: "scripts/shots/manual.png" });
await page.click(".drawer-head button");

// console drawer
await page.click('[data-role="btn-console"]');
await page.waitForSelector(".console-tool");
await page.click('.console-tool[data-tool-name="consult_manual"]');
await page.waitForTimeout(250);
await page.screenshot({ path: "scripts/shots/console.png" });
await page.click(".drawer-head button");

// Deterministic detonation: press a known-wrong glyph key three times.
const manualText = await page.evaluate(() => window.__callTool("consult_manual", { section: "keypad" }));
const columns = [...manualText.matchAll(/COLUMN \d+:\n([\s\S]*?)(?=\n\nCOLUMN|\n\nGLYPH)/g)].map((m) =>
  m[1].trim().split("\n").map((line) => line.trim().split(/\s{2,}/)[1].split(" (")[0])
);
const shown = await page.$$eval(".key", (els) => els.map((e) => e.getAttribute("aria-label").match(/showing (.+) symbol/)[1]));
const col = columns.find((c) => shown.every((n) => c.includes(n)));
const order = col.filter((n) => shown.includes(n));
const wrong = shown.find((n) => n !== order[0]);
for (let i = 0; i < 3; i++) {
  await page.locator(`.key[aria-label="key showing ${wrong} symbol"]`).click();
  await page.waitForTimeout(350);
}
await page.waitForTimeout(600);
await page.screenshot({ path: "scripts/shots/boom.png" });
await page.waitForTimeout(1600);
if (await page.locator(".debrief-banner").count()) {
  await page.screenshot({ path: "scripts/shots/debrief.png", fullPage: true });
}

// Capture the winning coaching handoff used in the README/submission gallery.
await page.locator(".btn-ghost", { hasText: "MISSION SELECT" }).click();
await page.click(".mission-card:nth-child(1)");
await page.click(".btn-arm");
await page.waitForSelector(".wire-bay");
await page.evaluate(() => window.__callTool("scan_data_tag"));
await page.evaluate(() => window.__callTool("consult_manual", { section: "wires" }));
const tag = await page.evaluate(() => window.__callTool("scan_data_tag"));
const odd = String(tag).includes("ODD");
const colors = await page.$$eval(".wire", (els) =>
  els.map((el) => el.getAttribute("aria-label").split(",")[1].trim())
);
const colorCount = (color) => colors.filter((value) => value === color).length;
let safeWire = 0;
if (colorCount("red") === 0) safeWire = 1;
else if (colors.at(-1) === "white") safeWire = colors.length - 1;
else if (colorCount("blue") > 1) safeWire = colors.lastIndexOf("blue");
void odd; // the three-wire rules do not need serial parity, but the scan is part of the agent path.
await page.locator(".wire").nth(safeWire).click();
await page.locator(".btn-danger", { hasText: "CONFIRM CUT" }).click();
await page.waitForSelector(".debrief-banner");
await page.screenshot({ path: "scripts/shots/skills-debrief.png", fullPage: true });

await browser.close();
server.close();
console.log("shots saved");
