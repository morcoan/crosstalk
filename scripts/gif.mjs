/**
 * Records a short demo clip for the README: native WebMCP (Chromium with
 * --enable-features=WebMCPTesting), agent drives tools via executeTool, human
 * clicks the DOM. Output: scripts/shots/demo.webm (convert to GIF with ffmpeg).
 *
 * Run: npm run build && node scripts/gif.mjs
 */
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
await new Promise((r) => server.listen(4576, r));

const browser = await chromium.launch({ args: ["--enable-features=WebMCPTesting"] });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: "scripts/shots/", size: { width: 1280, height: 800 } }
});
const page = await context.newPage();

const call = (n, a = {}) =>
  page.evaluate(
    async ({ n, a }) => {
      const t = (await document.modelContext.getTools()).find((x) => x.name === n);
      return document.modelContext.executeTool(t, JSON.stringify(a));
    },
    { n, a }
  );

await page.goto("http://localhost:4576/");
await page.waitForSelector(".mission-card");
await page.waitForTimeout(1600); // menu beauty shot

// Agent starts the mission itself (visible navigation via tool call).
await call("start_mission", { mission_id: "handshake" });
await page.waitForSelector(".btn-arm");
await page.waitForTimeout(1400);
await page.click(".btn-arm");
await page.waitForSelector(".wire-bay");
await page.waitForTimeout(900);

// Agent working: each call lands in the activity feed.
await call("get_device_state");
await page.waitForTimeout(900);
const tag = String(await call("scan_data_tag"));
await page.waitForTimeout(900);
await call("consult_manual", { section: "wires" });
await page.waitForTimeout(1100);

// Human reads wires, agent's rule, human cuts.
const odd = tag.includes("ODD");
const colors = await page.$$eval(".wire", (els) => els.map((el) => el.getAttribute("aria-label").split(",")[1].trim()));
const cnt = (c) => colors.filter((x) => x === c).length;
let cut;
if (cnt("red") === 0) cut = 1;
else if (colors.at(-1) === "white") cut = colors.length - 1;
else if (cnt("blue") > 1) cut = colors.lastIndexOf("blue");
else cut = 0;
await page.locator(".wire").nth(cut).hover();
await page.waitForTimeout(500);
await page.locator(".wire").nth(cut).click();
await page.waitForTimeout(800);
await page.locator(".btn-danger", { hasText: "CONFIRM CUT" }).click();
await page.waitForSelector(".debrief-banner");
await page.waitForTimeout(1000); // banner + stats
await page.evaluate(() => document.querySelector(".skills")?.scrollIntoView({ block: "center", behavior: "smooth" }));
await page.waitForTimeout(1800); // FIELD SKILLS debrief — the impact thesis on screen

const video = page.video();
await context.close();
const path = await video.path();
await browser.close();
server.close();
console.log("recorded:", path);
