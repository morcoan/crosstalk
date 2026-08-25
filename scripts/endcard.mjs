import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto(pathToFileURL(resolve("../video/endcard.html")).href);
await p.waitForTimeout(600);
await p.screenshot({ path: "../video/endcard.png" });
await b.close();
console.log("endcard.png");
