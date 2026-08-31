import { chromium, firefox, webkit } from "playwright";
const url = process.argv[2] ?? "https://morcoan.github.io/crosstalk/";
for (const [name, engine] of [["firefox", firefox], ["webkit", webkit]]) {
  const b = await engine.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 950 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(url);
  await p.waitForSelector(".mission-card");
  // solo-path sanity: open manual drawer + tool console + start a mission via UI
  await p.click('[data-role="btn-manual"]');
  await p.waitForSelector(".manual-text");
  await p.click(".drawer-head button");
  await p.click('[data-role="btn-console"]');
  await p.waitForSelector(".console-tool");
  await p.click(".drawer-head button");
  await p.click(".mission-card:nth-child(1)");
  await p.waitForSelector(".btn-arm");
  await p.click(".btn-arm");
  await p.waitForSelector(".wire-bay");
  await p.waitForTimeout(700);
  await p.screenshot({ path: `scripts/shots/live-${name}.png` });
  console.log(`${name}: menu+manual+console+mission OK at ${url}, pageerrors=${errors.length}${errors.length ? " :: " + errors.join(" | ") : ""}`);
  await b.close();
}
