/**
 * Records the three demo-video takes against Chromium's NATIVE WebMCP runtime.
 * Each take is an independent context (fresh page) recorded at 1280x800.
 * Emits ../video/takeN.webm + ../video/takes.json (measured events for compositing).
 *
 * Run from crosstalk/: npm run build && node scripts/takes.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, rename } from "node:fs/promises";
import { extname, join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const OUT = new URL("../../video/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
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
await new Promise((r) => server.listen(4577, r));

const browser = await chromium.launch({ args: ["--enable-features=WebMCPTesting"] });
const meta = {};

async function record(name, fn) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 800 } }
  });
  const page = await context.newPage();
  const callOnce = (n, a = {}) =>
    page.evaluate(
      async ({ n, a }) => {
        const t = (await document.modelContext.getTools()).find((x) => x.name === n);
        if (!t) throw new Error(`tool missing: ${n}`);
        return document.modelContext.executeTool(t, JSON.stringify(a));
      },
      { n, a }
    );
  // Chromium's executeTool occasionally fails with a transient mojo error under
  // rapid successive calls — retry with backoff (agents do the same).
  const call = async (n, a = {}) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await callOnce(n, a);
      } catch (err) {
        if (attempt >= 4 || !String(err).includes("transient")) throw err;
        await page.waitForTimeout(500 * attempt);
      }
    }
  };
  await page.goto("http://localhost:4577/");
  await page.waitForSelector(".mission-card");
  const info = await fn(page, call);
  const video = page.video();
  await context.close();
  const tmp = await video.path();
  await rename(tmp, join(OUT, `${name}.webm`));
  meta[name] = info ?? {};
  console.log(`recorded ${name}.webm`, JSON.stringify(info ?? {}));
}

/* ------------ TAKE 1: hook + mission 1 + declarative field report ------------ */
await record("take1", async (page, call) => {
  await page.waitForTimeout(16_800); // n00 + n01 over the menu
  await call("start_mission", { mission_id: "handshake" }); // n02: "my agent starts the mission itself"
  await page.waitForSelector(".btn-arm");
  await page.waitForTimeout(4_700);
  await page.click(".btn-arm");
  await page.waitForSelector(".wire-bay");
  await page.waitForTimeout(1_500); // n03 begins
  const tag = String(await call("scan_data_tag"));
  await page.waitForTimeout(2_000);
  await call("consult_manual", { section: "wires" });
  await page.waitForTimeout(2_000);
  await call("get_device_state");
  // n04 rides over the feed filling up
  await page.waitForTimeout(9_000);
  // n05: the cut
  const odd = tag.includes("ODD");
  const colors = await page.$$eval(".wire", (els) => els.map((el) => el.getAttribute("aria-label").split(",")[1].trim()));
  const cnt = (c) => colors.filter((x) => x === c).length;
  let cut;
  if (cnt("red") === 0) cut = 1;
  else if (colors.at(-1) === "white") cut = colors.length - 1;
  else if (cnt("blue") > 1) cut = colors.lastIndexOf("blue");
  else cut = 0;
  await page.locator(".wire").nth(cut).hover();
  await page.waitForTimeout(1_200);
  await page.locator(".wire").nth(cut).click();
  await page.waitForTimeout(2_300);
  await page.locator(".btn-danger", { hasText: "CONFIRM CUT" }).click();
  await page.waitForSelector(".debrief-banner");
  await page.waitForTimeout(2_500);
  // n06: agent files the declarative field report
  let declarative = "executeTool";
  try {
    await call("file_field_report", { callsign: "WIRE WOLVES", note: "Clean cut. Zero strikes." });
  } catch {
    declarative = "dom-fallback";
    await page.fill("#callsign", "WIRE WOLVES");
    await page.fill("#note", "Clean cut. Zero strikes.");
    await page.click(".report-form button[type=submit]");
  }
  await page.waitForTimeout(7_000);
  return { declarative };
});

/* ------------ TAKE 2: the regulator inversion ------------ */
await record("take2", async (page, call) => {
  await page.waitForTimeout(800);
  await call("start_mission", { mission_id: "crossed-wires" });
  await page.waitForSelector(".btn-arm");
  await page.waitForTimeout(2_500);
  await page.click(".btn-arm");
  await page.waitForSelector(".gauge");
  await page.evaluate(() => document.querySelector(".gauge").scrollIntoView({ block: "center", behavior: "smooth" }));
  await page.waitForTimeout(1_800); // n08 starts
  const readGauge = () =>
    page.$eval(".gauge-readout", (el) => {
      const b = el.querySelectorAll("b");
      return { needle: Number(b[0].textContent), zone: b[1].textContent.split("–").map(Number) };
    });
  // paced nudges while n08+n09 narrate (~17s)
  let g = await readGauge();
  const started = Date.now();
  let locked = false;
  while (Date.now() - started < 16_500) {
    g = await readGauge();
    const mid = (g.zone[0] + g.zone[1]) / 2;
    if (g.needle > g.zone[0] + 0.5 && g.needle < g.zone[1] - 0.5) {
      if (Date.now() - started > 14_000) {
        await call("lock_regulator");
        locked = true;
        break;
      }
      await page.waitForTimeout(700);
      continue;
    }
    await call("nudge_regulator", {
      direction: g.needle < mid ? "up" : "down",
      magnitude: Math.abs(mid - g.needle) > 10 ? "coarse" : "fine"
    });
    await page.waitForTimeout(2_100);
  }
  if (!locked) {
    for (let i = 0; i < 10 && !locked; i++) {
      g = await readGauge();
      const mid = (g.zone[0] + g.zone[1]) / 2;
      if (g.needle > g.zone[0] + 0.5 && g.needle < g.zone[1] - 0.5) {
        await call("lock_regulator");
        locked = true;
      } else {
        await call("nudge_regulator", { direction: g.needle < mid ? "up" : "down", magnitude: "fine" });
        await page.waitForTimeout(900);
      }
    }
  }
  await page.waitForTimeout(6_500); // n10 over the board with the regulator green
  return { locked };
});

/* ------------ TAKE 3: signal + tool console + close ------------ */
await record("take3", async (page, call) => {
  await page.waitForTimeout(600);
  await call("start_mission", { mission_id: "silent-frequency" });
  await page.waitForSelector(".btn-arm");
  await page.waitForTimeout(1_600);
  await page.click(".btn-arm");
  await page.waitForSelector(".speaker-led");
  const armedAt = Date.now();
  // sample the LED for ~5.6s (n11 narrates meanwhile)
  const samples = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = [];
        const led = () => document.querySelector(".speaker-led")?.classList.contains("is-on") ?? false;
        const t0 = performance.now();
        const iv = setInterval(() => {
          out.push({ t: performance.now() - t0, on: led() });
          if (performance.now() - t0 > 5600) {
            clearInterval(iv);
            resolve(out);
          }
        }, 16);
      })
  );
  const runs = [];
  let start = null;
  for (const s of samples) {
    if (s.on && start === null) start = s.t;
    if (!s.on && start !== null) {
      runs.push({ at: start, dur: s.t - start });
      start = null;
    }
  }
  const words = runs.map((r) => (r.dur > 250 ? "long" : "short"));
  const pattern = (words.length > 3 ? words.slice(1, 4) : words.slice(0, 3)).join(" ");
  // keep watching the LED pulse while narration explains (rest of n11)
  await page.waitForTimeout(3_500);
  const manualText = await call("consult_manual", { section: "signal" });
  const row = String(manualText).split("\n").find((l) => l.trim().startsWith(pattern));
  const mhz = Number(row.match(/([\d.]+) MHz/)[1]);
  await call("set_transmitter_frequency", { mhz });
  await page.waitForTimeout(1_800);
  await page.locator(".btn-transmit").click();
  await page.waitForTimeout(1_700);
  // n12: open the tool console — live toolset on camera
  await page.click('[data-role="btn-console"]');
  await page.waitForSelector(".console-tool");
  await page.waitForTimeout(8_600);
  await page.click(".drawer-head button");
  // n13 over the ticking device
  await page.waitForTimeout(8_200);
  return { pattern, mhz, sampledAfterArmMs: Date.now() - armedAt };
});

await browser.close();
server.close();
await writeFile(join(OUT, "takes.json"), JSON.stringify(meta, null, 2));
console.log("takes.json written");
