/**
 * DEEP production verification: plays missions 2 and 3 end-to-end on the
 * DEPLOYED site through Chromium's NATIVE WebMCP API — every agent action goes
 * through document.modelContext.executeTool(), every human action through the DOM.
 * Covers on the production origin: regulator servo loop, keypad column lookup,
 * echo memory chain (with get_echo_log), signal LED transcription + frequency
 * seating, wires rules, dynamic tool lifecycles.
 *
 * Run: node scripts/native-live-deep.mjs [url]
 */
import { chromium } from "playwright";

const URL = process.argv[2] ?? "https://morcoan.github.io/crosstalk/";
const browser = await chromium.launch({ args: ["--enable-features=WebMCPTesting"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

const fails = [];
const check = (label, cond) => {
  console.log(`${cond ? "  ok" : "FAIL"}  ${label}`);
  if (!cond) fails.push(label);
};
page.on("pageerror", (e) => fails.push(`pageerror: ${e.message}`));

const callOnce = (n, a = {}) =>
  page.evaluate(
    async ({ n, a }) => {
      const t = (await document.modelContext.getTools()).find((x) => x.name === n);
      if (!t) throw new Error(`tool missing: ${n}`);
      return document.modelContext.executeTool(t, JSON.stringify(a));
    },
    { n, a }
  );
const call = async (n, a = {}) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await callOnce(n, a);
    } catch (err) {
      if (attempt >= 4 || !String(err).includes("transient")) throw err;
      await page.waitForTimeout(400 * attempt);
    }
  }
};

async function armMission(id) {
  await call("start_mission", { mission_id: id });
  await page.waitForSelector(".btn-arm");
  await page.click(".btn-arm");
  await page.waitForSelector(".module-grid");
}

function solveWires(colors, odd) {
  const n = colors.length;
  const cnt = (c) => colors.filter((x) => x === c).length;
  const last = colors[n - 1];
  if (n === 3) {
    if (cnt("red") === 0) return 1;
    if (last === "white") return n - 1;
    if (cnt("blue") > 1) return colors.lastIndexOf("blue");
    return 0;
  }
  if (n === 4) {
    if (cnt("yellow") > 1 && odd) return colors.lastIndexOf("yellow");
    if (cnt("blue") === 0) return 0;
    if (cnt("green") === 1) return colors.indexOf("green");
    return n - 1;
  }
  if (last === "black" && !odd) return 3;
  if (cnt("red") === 1 && cnt("green") > 1) return colors.indexOf("red");
  if (cnt("yellow") === 0) return 1;
  return 0;
}

async function playWires() {
  const tag = String(await call("scan_data_tag"));
  const odd = tag.includes("ODD");
  const colors = await page.$$eval(".wire", (els) => els.map((el) => el.getAttribute("aria-label").split(",")[1].trim()));
  const cut = solveWires(colors, odd);
  console.log(`     wires [${colors.join(", ")}] serial ${odd ? "odd" : "even"} → cut #${cut + 1}`);
  await page.locator(".wire").nth(cut).click();
  await page.locator(".btn-danger", { hasText: "CONFIRM CUT" }).click();
  await page.waitForTimeout(150);
}

async function playKeypad() {
  const manual = String(await call("consult_manual", { section: "keypad" }));
  const columns = [...manual.matchAll(/COLUMN \d+:\n([\s\S]*?)(?=\n\nCOLUMN|\n\nGLYPH)/g)].map((m) =>
    m[1].trim().split("\n").map((l) => l.trim().split(/\s{2,}/)[1].split(" (")[0])
  );
  const shown = await page.$$eval(".key", (els) => els.map((e) => e.getAttribute("aria-label").match(/showing (.+) symbol/)[1]));
  const col = columns.find((c) => shown.every((n) => c.includes(n)));
  const order = col.filter((n) => shown.includes(n));
  console.log(`     keypad [${shown.join(", ")}] → ${order.join(" → ")}`);
  for (const name of order) {
    await page.locator(`.key[aria-label="key showing ${name} symbol"]`).click();
    await page.waitForTimeout(80);
  }
}

async function playRegulator() {
  const readGauge = () =>
    page.$eval(".gauge-readout", (el) => {
      const b = el.querySelectorAll("b");
      return { needle: Number(b[0].textContent), zone: b[1].textContent.split("–").map(Number) };
    });
  let g = await readGauge();
  console.log(`     regulator needle ${g.needle}, zone ${g.zone[0]}-${g.zone[1]}`);
  for (let i = 0; i < 40; i++) {
    if (g.needle > g.zone[0] && g.needle < g.zone[1]) break;
    const mid = (g.zone[0] + g.zone[1]) / 2;
    await call("nudge_regulator", {
      direction: g.needle < mid ? "up" : "down",
      magnitude: Math.abs(mid - g.needle) > 10 ? "coarse" : "fine"
    });
    g = await readGauge();
  }
  const lock = String(await call("lock_regulator"));
  if (!lock.includes("LOCKED")) fails.push(`lock failed: ${lock}`);
  await page.waitForTimeout(250);
}

async function playEcho() {
  const manual = String(await call("consult_manual", { section: "echo" }));
  for (let stage = 1; stage <= 4; stage++) {
    const display = Number(await page.textContent(".echo-display"));
    const labels = await page.$$eval(".echo-btn", (els) => els.map((e) => Number(e.textContent)));
    const block = manual.match(new RegExp(`STAGE ${stage}:\\n([\\s\\S]*?)(?=\\n\\nSTAGE|$)`))[1];
    const line = block.match(new RegExp(`Display ${display} → press the button (.*)\\.`))[1];
    let pos, m;
    if ((m = line.match(/in POSITION (\d)/))) pos = Number(m[1]);
    else if ((m = line.match(/^LABELED (\d)/))) pos = labels.indexOf(Number(m[1])) + 1;
    else {
      const log = String(await call("get_echo_log"));
      const ref = Number(line.match(/stage (\d)/)[1]);
      const entry = log.match(new RegExp(`Stage ${ref}: .*pressed POSITION (\\d), which was LABELED (\\d)`));
      pos = /SAME POSITION/.test(line) ? Number(entry[1]) : labels.indexOf(Number(entry[2])) + 1;
    }
    console.log(`     echo s${stage}: display ${display}, labels [${labels.join(",")}] → pos ${pos}`);
    await page.locator(".echo-btn").nth(pos - 1).click();
    await page.waitForTimeout(120);
  }
}

async function playSignal() {
  const samples = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = [];
        const led = () => document.querySelector(".speaker-led")?.classList.contains("is-on") ?? false;
        const t0 = performance.now();
        const iv = setInterval(() => {
          out.push({ t: performance.now() - t0, on: led() });
          if (performance.now() - t0 > 8200) {
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
  let pattern = null;
  for (let i = 1; i + 2 < runs.length; i++) {
    const gap = runs[i].at - (runs[i - 1].at + runs[i - 1].dur);
    if (gap > 900) {
      pattern = runs.slice(i, i + 3).map((r) => (r.dur > 250 ? "long" : "short")).join(" ");
      break;
    }
  }
  if (!pattern) {
    const words = runs.map((r) => (r.dur > 250 ? "long" : "short"));
    pattern = (words.length > 3 ? words.slice(1, 4) : words.slice(0, 3)).join(" ");
  }
  const manual = String(await call("consult_manual", { section: "signal" }));
  const row = manual.split("\n").find((l) => l.trim().startsWith(pattern));
  const mhz = Number(row.match(/([\d.]+) MHz/)[1]);
  console.log(`     signal "${pattern}" → ${mhz} MHz`);
  const seat = String(await call("set_transmitter_frequency", { mhz }));
  if (!seat.includes("seated")) fails.push(`seat failed: ${seat}`);
  await page.locator(".btn-transmit").click();
  await page.waitForTimeout(250);
}

/* --------------------------------- run --------------------------------- */

await page.goto(URL);
await page.waitForSelector(".mission-card");
check("live site renders", true);

/* Mission 2: regulator + wires4 + keypad */
await armMission("crossed-wires");
await playRegulator();
check("regulator tools aborted after solve (production)", !String(await page.evaluate(async () => (await document.modelContext.getTools()).map((t) => t.name))).includes("nudge_regulator"));
await playWires();
await playKeypad();
await page.waitForSelector(".debrief-banner");
check("MISSION 2 disarmed on production via native API", (await page.textContent(".debrief-banner")).trim() === "DEVICE DISARMED");

/* Mission 3: keypad + echo + signal + wires5 */
await armMission("silent-frequency");
await playKeypad();
await playEcho();
await playSignal();
await playWires();
await page.waitForSelector(".debrief-banner");
check("MISSION 3 disarmed on production via native API", (await page.textContent(".debrief-banner")).trim() === "DEVICE DISARMED");
check("zero strikes across both missions", (await page.locator(".strike-led.is-hit").count()) === 0);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES:\n${fails.join("\n")}` : "\nDEEP LIVE VERIFICATION PASSED — missions 2+3 disarmed on production, native API only");
process.exit(fails.length ? 1 : 0);
