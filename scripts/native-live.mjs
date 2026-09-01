// Native WebMCP verification against the DEPLOYED site.
import { chromium } from "playwright";
const URL = process.argv[2] ?? "https://morcoan.github.io/crosstalk/";
const browser = await chromium.launch({ args: ["--enable-features=WebMCPTesting"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const fails = [];
const check = (l, c) => { console.log(`${c ? "  ok" : "FAIL"}  ${l}`); if (!c) fails.push(l); };
page.on("pageerror", (e) => fails.push(`pageerror: ${e.message}`));
page.on("console", (message) => {
  if (message.type() === "error") fails.push(`console.error: ${message.text().slice(0, 200)}`);
});
page.on("requestfailed", (request) => {
  fails.push(`requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`);
});
const navigation = await page.goto(URL, { waitUntil: "domcontentloaded" });
check("live origin returns a successful document", navigation?.ok() === true);
await page.waitForSelector(".mission-card");
check("live site renders", true);
check("live layout renders both responsive linked badges", (await page.locator(".badge.is-linked").count()) === 2);
check("exactly one linked badge is visible", (await page.locator(".badge.is-linked:visible").count()) === 1);
const names = await page.evaluate(async () => (await document.modelContext.getTools()).map((t) => t.name).sort());
console.log("     live native tools:", names.join(", "));
check("base tools natively registered on production origin", names.length === 5 && names.includes("get_training_record"));
const call = (n, a = {}) => page.evaluate(async ({ n, a }) => {
  const t = (await document.modelContext.getTools()).find((x) => x.name === n);
  return document.modelContext.executeTool(t, JSON.stringify(a));
}, { n, a });
await call("start_mission", { mission_id: "handshake" });
await page.waitForSelector(".btn-arm"); await page.click(".btn-arm");
await page.waitForSelector(".wire-bay");
const tag = String(await call("scan_data_tag"));
const odd = tag.includes("ODD");
const colors = await page.$$eval(".wire", (els) => els.map((el) => el.getAttribute("aria-label").split(",")[1].trim()));
const cnt = (c) => colors.filter((x) => x === c).length;
let cut; if (cnt("red") === 0) cut = 1; else if (colors.at(-1) === "white") cut = colors.length - 1; else if (cnt("blue") > 1) cut = colors.lastIndexOf("blue"); else cut = 0;
console.log(`     wires [${colors.join(", ")}] serial ${odd ? "odd" : "even"} → cut #${cut + 1}`);
await page.locator(".wire").nth(cut).click();
await page.locator(".btn-danger", { hasText: "CONFIRM CUT" }).click();
await page.waitForSelector(".debrief-banner");
check("LIVE mission disarmed via native executeTool", (await page.textContent(".debrief-banner")).trim() === "DEVICE DISARMED");

// Declarative API on production: the debrief form must surface as a native tool
// and be executable end-to-end (browser fills the form, toolautosubmit fires).
await page.waitForTimeout(500);
const debriefTools = await page.evaluate(async () => (await document.modelContext.getTools()).map((t) => t.name));
check("LIVE session review registered natively", debriefTools.includes("review_last_session"));
const review = String(await call("review_last_session"));
check("LIVE session review returns evidence-bounded coaching", review.includes("COACHING:") && review.includes("Evidence boundary"));
check("LIVE declarative form registered natively", debriefTools.includes("file_field_report"));
try {
  await call("file_field_report", { callsign: "PREFLIGHT CREW", note: "Live declarative check." });
  await page.waitForTimeout(400);
  const log = await page.textContent(".squad-log");
  check("LIVE declarative form filed (squad log updated)", log.includes("PREFLIGHT CREW"));
} catch (e) {
  check(`LIVE declarative form executable (${String(e).slice(0, 80)})`, false);
}
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nLIVE NATIVE VERIFICATION PASSED");
process.exit(fails.length ? 1 : 0);
