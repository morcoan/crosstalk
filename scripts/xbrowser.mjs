/** Cross-browser fallback verification against the built artifact. Run after `npm run build`. */
import { firefox, webkit } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".gif": "image/gif",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function requestedFile(requestUrl = "/") {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  const requestPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(DIST, requestPath);
  const fromDist = relative(DIST, candidate);
  if (fromDist.startsWith("..") || isAbsolute(fromDist)) throw new Error("request escaped dist");
  return candidate;
}

const server = createServer(async (request, response) => {
  try {
    const file = requestedFile(request.url);
    const data = await readFile(file);
    response.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(data);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("not found");
  }
});

const failures = [];

try {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("loopback server did not expose a TCP port");
  const url = `http://127.0.0.1:${address.port}/`;

  for (const [name, engine] of [["firefox", firefox], ["webkit", webkit]]) {
    let browser;
    let page;
    const errors = [];
    try {
      browser = await engine.launch();
      page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
      page.setDefaultTimeout(10_000);
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console.error: ${message.text().slice(0, 200)}`);
      });
      page.on("requestfailed", (request) => {
        errors.push(`requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`);
      });
      page.on("response", (received) => {
        if (received.status() >= 400) errors.push(`HTTP ${received.status()}: ${received.url()}`);
      });

      const navigation = await page.goto(url, { waitUntil: "domcontentloaded" });
      if (!navigation?.ok()) errors.push(`document navigation returned ${navigation?.status() ?? "no response"}`);
      await page.waitForSelector(".mission-card");

      // Solo-path sanity: open both drawers and arm the first mission through the UI.
      await page.locator('[data-role="btn-manual"]:visible').click();
      await page.waitForSelector(".manual-text");
      await page.getByRole("button", { name: "Close field manual" }).click();
      await page.locator('[data-role="btn-console"]:visible').click();
      await page.waitForSelector(".console-tool");
      await page.getByRole("button", { name: "Close Agent Kit" }).click();
      await page.click(".mission-card:nth-child(1)");
      await page.waitForSelector(".btn-arm");
      await page.click(".btn-arm");
      await page.waitForSelector(".wire-bay");
      await page.waitForTimeout(250);

      if (errors.length) failures.push(...errors.map((error) => `${name}: ${error}`));
      else console.log(`${name}: local menu + drawers + mission path passed with no runtime or network errors`);
    } catch (error) {
      if (errors.length) failures.push(...errors.map((runtimeError) => `${name}: ${runtimeError}`));
      const state = page
        ? await page.evaluate(() => ({
            drawerClass: document.querySelector(".drawer-host")?.className ?? "missing",
            manualCount: document.querySelectorAll(".manual-text").length,
            manualExpanded: document.querySelector('[data-role="btn-manual"]')?.getAttribute("aria-expanded")
          })).catch(() => null)
        : null;
      failures.push(`${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      if (state) failures.push(`${name}: UI state ${JSON.stringify(state)}`);
    } finally {
      await browser?.close();
    }
  }
} finally {
  if (server.listening) await new Promise((resolveClose) => server.close(resolveClose));
}

if (failures.length) {
  console.error(`\nCROSS-BROWSER CHECK FAILED\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nCROSS-BROWSER CHECK PASSED — Firefox and WebKit loaded the local production artifact cleanly");
