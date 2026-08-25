import { chromium } from "playwright";
const combos = [
  ["--enable-features=WebMCPTesting"],
  ["--enable-features=WebMCP"],
  ["--enable-blink-features=WebMCP"],
  ["--enable-blink-features=WebMCPTesting"],
  ["--enable-blink-features=ModelContext"],
  ["--enable-features=WebMCPTesting", "--enable-blink-features=WebMCP"],
  ["--enable-experimental-web-platform-features"]
];
for (const args of combos) {
  const b = await chromium.launch({ args });
  const p = await b.newPage();
  await p.goto("https://example.com");
  const res = await p.evaluate(() => ({
    doc: "modelContext" in document,
    nav: "modelContext" in navigator
  }));
  console.log(JSON.stringify(args), "→", JSON.stringify(res));
  await b.close();
}
