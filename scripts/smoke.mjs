/**
 * End-to-end proof: boots the built app in headless Chromium with a stubbed
 * document.modelContext (the WebMCP surface) and plays EVERY module type the
 * way a real human+agent team would:
 *   - the "agent" only reads tool output (manual text, scans, logs) and calls actuators;
 *   - the "human" only reads the rendered DOM and clicks buttons.
 * If this passes, the game is provably solvable end-to-end over WebMCP.
 *
 * Run: npm run build && node scripts/smoke.mjs
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
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(4573, resolve));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

// ---- WebMCP stub: what ChatGPT's browser / Chrome provide natively ----
await page.addInitScript(() => {
  const tools = new Map();
  Object.defineProperty(document, "modelContext", {
    value: {
      async registerTool(tool, options) {
        tools.set(tool.name, tool);
        // Identity-safe like the native implementation: an aborted registration
        // must not tear down a newer tool that reused the name.
        options?.signal?.addEventListener("abort", () => {
          if (tools.get(tool.name) === tool) tools.delete(tool.name);
        });
      },
      async getTools() {
        return [...tools.values()];
      }
    },
    configurable: false
  });
  window.__toolNames = () => [...tools.keys()].sort();
  window.__callTool = async (name, args = {}) => {
    const t = tools.get(name);
    if (!t) throw new Error(`tool not registered: ${name}`);
    return await t.execute(args);
  };
});

const fails = [];
const check = (label, cond) => {
  console.log(`${cond ? "  ok" : "FAIL"}  ${label}`);
  if (!cond) fails.push(label);
};
page.on("pageerror", (err) => fails.push(`pageerror: ${err.message}`));

const tool = (name, args) => page.evaluate(({ n, a }) => window.__callTool(n, a), { n: name, a: args ?? {} });
const toolNames = () => page.evaluate(() => window.__toolNames());

/* ----------------------- agent-side solvers (parse tool text only) ----------------------- */

function solveWires(colors, serialOdd) {
  const n = colors.length;
  const count = (c) => colors.filter((x) => x === c).length;
  const last = colors[n - 1];
  if (n === 3) {
    if (count("red") === 0) return 1;
    if (last === "white") return n - 1;
    if (count("blue") > 1) return colors.lastIndexOf("blue");
    return 0;
  }
  if (n === 4) {
    if (count("yellow") > 1 && serialOdd) return colors.lastIndexOf("yellow");
    if (count("blue") === 0) return 0;
    if (count("green") === 1) return colors.indexOf("green");
    return n - 1;
  }
  if (last === "black" && !serialOdd) return 3;
  if (count("red") === 1 && count("green") > 1) return colors.indexOf("red");
  if (count("yellow") === 0) return 1;
  return 0;
}

async function humanCutsWire(index) {
  await page.locator(".wire").nth(index).click();
  await page.locator(".btn-danger", { hasText: "CONFIRM CUT" }).click();
  await page.waitForTimeout(120);
}

async function playWires() {
  const tag = await tool("scan_data_tag");
  const odd = tag.includes("ODD");
  const colors = await page.$$eval(".wire", (els) => els.map((el) => el.getAttribute("aria-label").split(",")[1].trim()));
  const cut = solveWires(colors, odd);
  console.log(`     wires: [${colors.join(", ")}], serial ${odd ? "odd" : "even"} → cut #${cut + 1}`);
  await humanCutsWire(cut);
}

function parseKeypadColumns(manualText) {
  return [...manualText.matchAll(/COLUMN \d+:\n([\s\S]*?)(?=\n\nCOLUMN|\n\nGLYPH)/g)].map((m) =>
    m[1]
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s{2,}/)[1].split(" (")[0])
  );
}

async function playKeypad() {
  const manualText = await tool("consult_manual", { section: "keypad" });
  const columns = parseKeypadColumns(manualText);
  const shown = await page.$$eval(".key", (els) => els.map((e) => e.getAttribute("aria-label").match(/showing (.+) symbol/)[1]));
  const col = columns.find((c) => shown.every((name) => c.includes(name)));
  const order = col.filter((name) => shown.includes(name));
  console.log(`     keypad: human sees [${shown.join(", ")}] → press ${order.join(" → ")}`);
  for (const name of order) {
    await page.locator(`.key[aria-label="key showing ${name} symbol"]`).click();
    await page.waitForTimeout(90);
  }
}

function parseEchoRule(manualText, stage, display) {
  const block = manualText.match(new RegExp(`STAGE ${stage}:\\n([\\s\\S]*?)(?=\\n\\nSTAGE|$)`))[1];
  const line = block.match(new RegExp(`Display ${display} → press the button (.*)\\.`))[1];
  let m;
  if ((m = line.match(/in POSITION (\d)/))) return { kind: "pos", value: Number(m[1]) };
  if ((m = line.match(/^LABELED (\d)/))) return { kind: "label", value: Number(m[1]) };
  if ((m = line.match(/SAME POSITION you pressed in stage (\d)/))) return { kind: "samePos", stage: Number(m[1]) };
  return { kind: "sameLabel", stage: Number(line.match(/SAME LABEL you pressed in stage (\d)/)[1]) };
}

async function playEcho() {
  const manualText = await tool("consult_manual", { section: "echo" });
  for (let stage = 1; stage <= 4; stage++) {
    const display = Number(await page.textContent(".echo-display"));
    const labels = await page.$$eval(".echo-btn", (els) => els.map((e) => Number(e.textContent)));
    const rule = parseEchoRule(manualText, stage, display);
    let pos;
    if (rule.kind === "pos") pos = rule.value;
    else if (rule.kind === "label") pos = labels.indexOf(rule.value) + 1;
    else {
      const log = await tool("get_echo_log");
      const entry = log.match(new RegExp(`Stage ${rule.stage}: .*pressed POSITION (\\d), which was LABELED (\\d)`));
      pos = rule.kind === "samePos" ? Number(entry[1]) : labels.indexOf(Number(entry[2])) + 1;
    }
    console.log(`     echo stage ${stage}: display ${display}, labels [${labels.join(",")}] → position ${pos}`);
    await page.locator(".echo-btn").nth(pos - 1).click();
    await page.waitForTimeout(120);
  }
}

/** Pause-anchored rhythm transcription: find the inter-cycle pause (>0.9s of
 *  silence), then read the three runs that follow it. Immune to sampling phase. */
function derivePattern(runs) {
  for (let i = 1; i + 2 < runs.length; i++) {
    const gap = runs[i].at - (runs[i - 1].at + runs[i - 1].dur);
    if (gap > 900) {
      return runs.slice(i, i + 3).map((r) => (r.dur > 250 ? "long" : "short")).join(" ");
    }
  }
  const words = runs.map((r) => (r.dur > 250 ? "long" : "short"));
  return (words.length > 3 ? words.slice(1, 4) : words.slice(0, 3)).join(" ");
}

async function sampleSpeakerLed(windowMs) {
  const samples = await page.evaluate(
    (win) =>
      new Promise((resolve) => {
        const out = [];
        const led = () => document.querySelector(".speaker-led")?.classList.contains("is-on") ?? false;
        const t0 = performance.now();
        const iv = setInterval(() => {
          out.push({ t: performance.now() - t0, on: led() });
          if (performance.now() - t0 > win) {
            clearInterval(iv);
            resolve(out);
          }
        }, 16);
      }),
    windowMs
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
  return runs;
}

async function playSignal() {
  // The "human" watches the speaker LED to transcribe the rhythm.
  const runs = await sampleSpeakerLed(8200);
  const pattern = derivePattern(runs);
  const manualText = await tool("consult_manual", { section: "signal" });
  const row = manualText.split("\n").find((l) => l.trim().startsWith(pattern));
  const mhz = Number(row.match(/([\d.]+) MHz/)[1]);
  console.log(`     signal: human hears "${pattern}" → agent seats ${mhz} MHz`);
  const seat = await tool("set_transmitter_frequency", { mhz });
  if (!seat.includes("seated")) fails.push(`seat failed: ${seat}`);
  await page.locator(".btn-transmit").click();
  await page.waitForTimeout(250);
  const feedTxt = await page.$$eval(".feed-row", (rows) => rows.map((r) => r.textContent).join("\n"));
  if (!feedTxt.includes("SIGNAL TX disarmed")) fails.push(`transmit did not disarm (pattern "${pattern}")`);
}

async function playRegulator() {
  const readGauge = () =>
    page.$eval(".gauge-readout", (el) => {
      const b = el.querySelectorAll("b");
      return { needle: Number(b[0].textContent), zone: b[1].textContent.split("–").map(Number) };
    });
  let g = await readGauge();
  console.log(`     regulator: needle ${g.needle}, zone ${g.zone[0]}-${g.zone[1]}`);
  for (let i = 0; i < 40; i++) {
    if (g.needle > g.zone[0] && g.needle < g.zone[1]) break;
    const mid = (g.zone[0] + g.zone[1]) / 2;
    await tool("nudge_regulator", {
      direction: g.needle < mid ? "up" : "down",
      magnitude: Math.abs(mid - g.needle) > 10 ? "coarse" : "fine"
    });
    g = await readGauge();
  }
  const lock = await tool("lock_regulator");
  if (!lock.includes("LOCKED")) fails.push(`lock failed: ${lock}`);
  await page.waitForTimeout(200); // deferred abort tick
}

async function armMission(id) {
  await tool("start_mission", { mission_id: id });
  await page.waitForSelector(".btn-arm");
  await page.click(".btn-arm");
  await page.waitForSelector(".module-grid");
}

const strikes = () => page.locator(".strike-led.is-hit").count();

/* --------------------------------- run --------------------------------- */

await page.goto("http://localhost:4573/");
await page.waitForSelector(".mission-card");

check("menu renders 3 mission cards", (await page.locator(".mission-card").count()) === 3);
check("agent-link badge is green", (await page.locator(".badge.is-linked").count()) === 1);
const baseTools = await toolNames();
console.log("     base tools:", baseTools.join(", "));
check(
  "base tools registered",
  ["consult_manual", "get_briefing", "get_device_state", "start_mission"].every((t) => baseTools.includes(t))
);

const briefing = await tool("get_briefing");
check("get_briefing explains roles", briefing.includes("YOUR SIDE") && briefing.includes("handshake"));
const badSection = await tool("consult_manual", { section: "nope" });
check("unknown manual section → instructive error", badSection.startsWith("TOOL ERROR"));

/* Mission 1 — wires only */
await armMission("handshake");
check("scan_data_tag live during mission", (await toolNames()).includes("scan_data_tag"));
const dupe = await tool("start_mission", { mission_id: "handshake" });
check("start_mission refuses while device live", dupe.startsWith("TOOL ERROR"));
await playWires();
await page.waitForSelector(".debrief-banner");
check("mission 1 disarmed", (await page.textContent(".debrief-banner")).trim() === "DEVICE DISARMED");
await page.waitForTimeout(250); // deferred abort tick
check("mission tools aborted after disarm", !(await toolNames()).includes("scan_data_tag"));

/* Mission 2 — wires + keypad + regulator */
await armMission("crossed-wires");
const t2 = await toolNames();
console.log("     mission 2 tools:", t2.join(", "));
check("regulator tools live", t2.includes("nudge_regulator") && t2.includes("lock_regulator"));
await playRegulator();
check("regulator tools aborted after solve", !(await toolNames()).includes("nudge_regulator"));
const feedText = await page.$$eval(".feed-row", (rows) => rows.map((r) => r.textContent).join("\n"));
check("activity feed narrates agent tool calls", feedText.includes("AGENT ⚙") && feedText.includes("nudge_regulator"));
await playWires();
await playKeypad();
await page.waitForSelector(".debrief-banner");
check("mission 2 disarmed", (await page.textContent(".debrief-banner")).trim() === "DEVICE DISARMED");

/* Mission 3 — keypad + echo + signal + wires */
await armMission("silent-frequency");
const t3 = await toolNames();
console.log("     mission 3 tools:", t3.join(", "));
check("echo + signal tools live", t3.includes("get_echo_log") && t3.includes("set_transmitter_frequency"));
const badFreq = await tool("set_transmitter_frequency", { mhz: 3.6 });
check("non-detent frequency politely refused", badFreq.startsWith("TOOL ERROR") && badFreq.includes("detent"));
await playKeypad();
await playEcho();
await playSignal();
await playWires();
await page.waitForSelector(".debrief-banner");
check("mission 3 disarmed (all five module types solved)", (await page.textContent(".debrief-banner")).trim() === "DEVICE DISARMED");
check("zero strikes across the entire run", (await strikes()) === 0);

const finalState = await tool("get_device_state");
check("get_device_state reports final disarm", finalState.includes("DISARMED"));
await page.waitForTimeout(250); // deferred abort tick
const finalTools = await toolNames();
check("toolset back to base 4 after mission", finalTools.length === 4);

await browser.close();
server.close();
console.log(fails.length ? `\n${fails.length} FAILURES:\n${fails.join("\n")}` : "\nALL SMOKE CHECKS PASSED — full co-op playthrough proven");
process.exit(fails.length ? 1 : 0);
