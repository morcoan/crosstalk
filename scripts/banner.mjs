/** Render the code-native workbench banner into social-preview PNGs. */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const svg = await readFile(new URL("../docs/banner.svg", import.meta.url), "utf8");
const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><style>
  * { box-sizing: border-box }
  html, body { width: 100%; height: 100%; margin: 0; background: #30251b }
  body { display: grid; place-items: center }
  img { display: block; width: 1200px; height: auto }
</style><img src="${data}" alt="">`);
await page.locator("img").waitFor();
await page.screenshot({ path: "public/og.png" });
await page.setViewportSize({ width: 1440, height: 500 });
await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}img{display:block;width:1440px;height:500px}</style><img src="${data}" alt="">`);
await page.screenshot({ path: "scripts/shots/banner-preview.png" });
await browser.close();
console.log("rendered public/og.png and scripts/shots/banner-preview.png");
