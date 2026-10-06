// Real components and production CSS, fixture data only. No database/provider calls.
import { createRequire } from "node:module";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = process.cwd();
const output = process.env.UI_SCREENSHOT_DIR;
if (!output) throw new Error("Set UI_SCREENSHOT_DIR");
await mkdir(output, { recursive: true });
const bundled = await build({ entryPoints: ["tests/fixtures/table-resize-harness.tsx"], absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const files = await readdir(path.join(root, ".next/static"), { recursive: true });
const css = (await Promise.all(files.filter((file) => file.endsWith(".css")).map((file) => readFile(path.join(root, ".next/static", file), "utf8")))).join("\n");
const server = createServer((request, response) => {
  if (request.url === "/app.js") { response.setHeader("content-type", "text/javascript"); response.end(bundled.outputFiles[0].text); }
  else if (request.url === "/app.css") { response.setHeader("content-type", "text/css"); response.end(css); }
  else { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const viewportWidth of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width: viewportWidth, height: 900 }, hasTouch: true });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    let requests = 0; await page.route("**/api/**", (route) => { requests++; return route.abort(); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const handle = page.getByRole("separator", { name: "Resize column Part", exact: true });
    const width = (id) => page.locator(`th[data-column-id="${id}"]`).evaluate((element) => element.getBoundingClientRect().width);
    const near = (actual, expected) => assert(Math.abs(actual - expected) < 2, `${actual} should match ${expected}`);
    async function resize(delta) {
      await handle.scrollIntoViewIfNeeded();
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 12 }); await page.mouse.up();
    }
    await handle.waitFor();
    const original = await width("part"); const other = await width("notes");
    await resize(100); near(await width("part"), Math.round(original) + 100); near(await width("notes"), Math.round(other));
    await resize(-80); const saved = await width("part"); near(saved, Math.round(original) + 20);
    await page.reload(); await handle.waitFor();
    await page.waitForFunction(() => document.querySelector("table").style.tableLayout === "fixed");
    near(await width("part"), saved);
    await page.getByRole("button", { name: "Reverse columns", exact: true }).click(); near(await width("part"), saved);
    await page.getByRole("button", { name: "Toggle table", exact: true }).click();
    await page.getByRole("button", { name: "Toggle table", exact: true }).click(); await handle.waitFor();
    await page.waitForFunction(() => document.querySelector("table").style.tableLayout === "fixed"); near(await width("part"), saved);
    await handle.press("ArrowRight"); near(await width("part"), saved + 10);
    await handle.press("Home"); near(await width("part"), 144);
    // Real touch input exercises pointer capture, not synthetic unregistered pointers.
    const session = await context.newCDPSession(page);
    async function touchResize(delta, cancel = false) {
      await handle.scrollIntoViewIfNeeded(); const box = await handle.boundingBox();
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, x: point.x + delta }] });
      await session.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
    }
    await touchResize(80);
    near(await width("part"), 224);
    await touchResize(30, true);
    near(await width("part"), 224);
    await handle.scrollIntoViewIfNeeded(); await handle.dblclick(); near(await width("part"), 144);
    await page.getByRole("textbox", { name: "Notes · row 1", exact: true }).fill("Still editable");
    await page.getByRole("textbox", { name: "Notes · row 1", exact: true }).press("Enter");
    assert.equal(await page.evaluate(() => window.resizeWrites), 1);
    await page.getByRole("button", { name: "Column options: Part", exact: true }).click();
    await page.getByRole("dialog", { name: "Column options: Part", exact: true }).waitFor();
    await page.getByRole("dialog", { name: "Column options: Part", exact: true }).press("Escape");
    await handle.press("ArrowLeft"); await handle.press("Shift+ArrowLeft"); await handle.press("Shift+ArrowLeft"); near(await width("part"), 56);
    await page.getByRole("button", { name: "Read only", exact: true }).click(); await handle.press("ArrowRight"); near(await width("part"), 66);
    await page.getByRole("button", { name: "Switch table", exact: true }).click();
    assert.equal(await page.locator("table").evaluate((element) => element.style.tableLayout), "");
    await page.getByRole("button", { name: "Switch table", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("table").style.tableLayout === "fixed"); near(await width("part"), 66);
    await handle.press("Shift+ArrowRight");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(requests, 0); assert.equal(await page.evaluate(() => window.resizeWrites), 1);
    await page.screenshot({ path: path.join(output, `table-resize-${viewportWidth}.png`) });
    await page.getByRole("button", { name: "Reset column widths", exact: true }).click();
    assert.equal(await page.locator("table").evaluate((element) => element.style.tableLayout), "");
    assert.equal(await page.evaluate(() => localStorage.getItem("private-manager:table-column-widths:resize-table")), null);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Table resize passed: drag wider/narrower, independent widths, storage/reload/remount/reorder, keyboard/reset, touch/cancel, menus/cells, read-only and isolated table scrolling. No API calls.");
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }