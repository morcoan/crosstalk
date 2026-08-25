import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--enable-features=WebMCPTesting"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto("https://morcoan.github.io/crosstalk/");
await p.waitForSelector(".mission-card");
await p.waitForTimeout(500);
await p.screenshot({ path: "scripts/shots/live-menu.png", fullPage: true });
await b.close();
console.log("saved");
