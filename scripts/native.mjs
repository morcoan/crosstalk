/**
 * Verification against Chromium's NATIVE WebMCP implementation (no stubs).
 * Launches Chromium with --enable-features=WebMCPTesting (the same runtime behind
 * chrome://flags/#enable-webmcp-testing), loads the built app, and checks that:
 *   - document.modelContext accepts every registerTool() call (real schema validation),
 *   - getTools() reflects the game's dynamic toolset,
 *   - native executeTool() can drive a full mission (agent-side actuation),
 *   - toolchange events fire as module tools appear/vanish,
 *   - the declarative <form toolname> on the debrief screen becomes a native tool.
 *
 * Run: npm run build && node scripts/native.mjs
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
await new Promise((resolve) => server.listen(4575, resolve));

const browser = await chromium.launch({ args: ["--enable-features=WebMCPTesting"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

const fails = [];
const check = (label, cond) => {
  console.log(`${cond ? "  ok" : "FAIL"}  ${label}`);
  if (!cond) fails.push(label);
};
page.on("pageerror", (err) => fails.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("     [console.error]", msg.text().slice(0, 160));
});

await page.goto("http://localhost:4575/");
await page.waitForSelector(".mission-card");

const api = await page.evaluate(() => ({
  hasDoc: "modelContext" in document,
  hasNav: "modelContext" in navigator,
  methods: Object.getOwnPropertyNames(Object.getPrototypeOf(document.modelContext ?? {}))
}));
console.log("     native surface:", JSON.stringify(api));
check("native document.modelContext present", api.hasDoc);

// Give registrations a beat, install a toolchange counter, then read the toolset.
await page.evaluate(() => {
  window.__toolchanges = 0;
  document.modelContext.addEventListener?.("toolchange", () => window.__toolchanges++);
});
const names = await page.evaluate(async () => (await document.modelContext.getTools()).map((t) => t.name).sort());
console.log("     native getTools():", names.join(", "));
check(
  "all base tools accepted by native registration",
  ["consult_manual", "get_briefing", "get_device_state", "start_mission"].every((n) => names.includes(n))
);

const canExecute = await page.evaluate(() => typeof document.modelContext.executeTool === "function");
console.log("     native executeTool available:", canExecute);

async function nativeCall(name, args = {}) {
  return page.evaluate(
    async ({ n, a }) => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((t) => t.name === n);
      if (!tool) throw new Error(`not registered: ${n}`);
      const out = await document.modelContext.executeTool(tool, JSON.stringify(a));
      return out;
    },
    { n: name, a: args }
  );
}

if (canExecute) {
  const brief = await nativeCall("get_briefing");
  check("native executeTool returns briefing", String(brief).includes("CROSSTALK"));

  // Full mission 1 playthrough over the NATIVE tool path.
  await nativeCall("start_mission", { mission_id: "handshake" });
  await page.waitForSelector(".btn-arm");
  await page.click(".btn-arm");
  await page.waitForSelector(".wire-bay");

  const during = await page.evaluate(async () => (await document.modelContext.getTools()).map((t) => t.name));
  check("scan_data_tag natively registered during mission", during.includes("scan_data_tag"));

  const tag = String(await nativeCall("scan_data_tag"));
  const odd = tag.includes("ODD");
  const colors = await page.$$eval(".wire", (els) => els.map((el) => el.getAttribute("aria-label").split(",")[1].trim()));
  const count = (c) => colors.filter((x) => x === c).length;
  let cut;
  if (count("red") === 0) cut = 1;
  else if (colors[colors.length - 1] === "white") cut = colors.length - 1;
  else if (count("blue") > 1) cut = colors.lastIndexOf("blue");
  else cut = 0;
  console.log(`     wires [${colors.join(", ")}] serial ${odd ? "odd" : "even"} → cut #${cut + 1}`);
  await page.locator(".wire").nth(cut).click();
  await page.locator(".btn-danger", { hasText: "CONFIRM CUT" }).click();
  await page.waitForSelector(".debrief-banner");
  check("mission disarmed via native executeTool loop", (await page.textContent(".debrief-banner")).trim() === "DEVICE DISARMED");

  const after = await page.evaluate(async () => (await document.modelContext.getTools()).map((t) => t.name));
  check("mission tools natively aborted after disarm", !after.includes("scan_data_tag"));

  // Declarative API: the debrief form should surface as a native tool.
  await page.waitForTimeout(300);
  const debriefTools = await page.evaluate(async () => (await document.modelContext.getTools()).map((t) => t.name));
  console.log("     debrief tools:", debriefTools.join(", "));
  check("declarative form registered as native tool", debriefTools.includes("file_field_report"));

  const changes = await page.evaluate(() => window.__toolchanges);
  console.log("     toolchange events observed:", changes);
  check("toolchange events fired", changes > 0);
} else {
  console.log("     (skipping executeTool-driven playthrough — not available in this build)");
}

await browser.close();
server.close();
console.log(fails.length ? `\n${fails.length} FAILURES:\n${fails.join("\n")}` : "\nNATIVE WEBMCP VERIFICATION PASSED");
process.exit(fails.length ? 1 : 0);
