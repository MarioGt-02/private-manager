// Real components, fixture API only. No database/provider requests.
import { createRequire } from "node:module";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = process.cwd(); const output = process.env.UI_SCREENSHOT_DIR;
if (!output) throw new Error("Set UI_SCREENSHOT_DIR");
await mkdir(output, { recursive: true });
const bundled = await build({ entryPoints: ["tests/fixtures/resizable-board.tsx"], absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "actions", setup(b) { b.onResolve({ filter: /^@\/lib\/actions\/object-actions$/ }, () => ({ path: path.join(root, "tests/fixtures/ui-actions.ts") })); } }] });
const files = await readdir(path.join(root, ".next/static"), { recursive: true });
const css = (await Promise.all(files.filter(f => f.endsWith(".css")).map(f => readFile(path.join(root, ".next/static", f), "utf8")))).join("\n");
const server = createServer((req, res) => {
  if (req.url === "/app.js") { res.setHeader("content-type", "text/javascript"); res.end(bundled.outputFiles[0].text); }
  else if (req.url === "/app.css") { res.setHeader("content-type", "text/css"); res.end(css); }
  else { res.setHeader("content-type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on("pageerror", error => errors.push(error.message));
const tech = { id: "c9300000-0000-4000-8000-000000000001", name: "Tech & Software", color: "blue", createdAt: new Date().toISOString() };
const categories = [tech]; let writes = 0; let failed = false; let ai = 0;
await page.route("**/api/**", async route => {
  const url = new URL(route.request().url()); let data = {};
  if (url.pathname.startsWith("/api/ai")) { ai++; throw new Error("Unexpected AI call"); }
  if (url.pathname === "/api/categories") {
    if (route.request().method() === "GET") data = { categories };
    else {
      const body = route.request().postDataJSON(); writes++;
      if (failed) { await route.fulfill({ status: 409, contentType: "application/json", body: "{}" }); return; }
      if (body.action === "assign") { data = { categoryId: body.categoryId }; await page.evaluate(body => { window.uiFixture.objects.find(o => o.id === body.objectId).categoryId = body.categoryId; }, body); }
      else if (body.action === "update") { Object.assign(categories.find(c => c.id === body.id), body.category); data = { category: categories.find(c => c.id === body.id) }; }
      else { const category = { id: "c9300000-0000-4000-8000-000000000099", ...body.category, createdAt: new Date().toISOString() }; categories.push(category); data = { category }; }
    }
  } else if (url.pathname.endsWith("/activity")) data = { updates: [] };
  else throw new Error(`Unexpected request ${url.pathname}`);
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
});
const cards = page.locator('article[role="button"]');
const drawer = page.getByRole("dialog", { name: "Object details" });
async function assign(index, id) {
  await cards.nth(index).click(); await drawer.getByLabel("Category", { exact: true }).selectOption(id);
  await page.waitForFunction(({ index, id }) => window.uiFixture.objects[index].categoryId === id, { index, id: id || null });
  await drawer.getByRole("button", { name: "Close Object Drawer" }).click();
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`); await cards.first().waitFor();
  await assign(0, tech.id); await assign(1, tech.id);
  assert.equal(await cards.nth(0).evaluate(e => getComputedStyle(e).borderLeftColor), "rgb(37, 99, 235)");
  await page.getByRole("button", { name: "Categories", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "Categories", exact: true });
  await manager.getByRole("button", { name: /Tech & Software/ }).click();
  await manager.getByRole("button", { name: "cyan", exact: true }).click();
  assert.equal(await manager.getByRole("button", { name: "cyan", exact: true }).getAttribute("aria-pressed"), "true");
  await manager.getByRole("button", { name: "Save category", exact: true }).click();
  await manager.getByLabel("Name", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('article[role="button"]').style.borderLeftColor === "rgb(8, 145, 178)");
  await manager.getByRole("button", { name: "Close", exact: true }).click();
  for (const index of [0, 1]) assert.equal(await cards.nth(index).evaluate(e => getComputedStyle(e).borderLeftColor), "rgb(8, 145, 178)");
  assert.equal(await cards.first().evaluate(e => getComputedStyle(e).backgroundColor), "rgb(255, 255, 255)");
  await cards.first().click(); failed = true;
  await drawer.getByLabel("Category", { exact: true }).selectOption("");
  await drawer.getByText("Could not save category. Please try again.").waitFor();
  assert.equal(await drawer.getByLabel("Category", { exact: true }).inputValue(), tech.id);
  failed = false; await drawer.getByLabel("Category", { exact: true }).selectOption("");
  await page.waitForFunction(() => window.uiFixture.objects[0].categoryId === null);
  await drawer.getByRole("button", { name: "Close Object Drawer" }).click();
  assert.equal(await cards.first().evaluate(e => getComputedStyle(e).borderLeftColor), "rgb(100, 116, 139)");
  await page.screenshot({ path: path.join(output, "categories-board.png") });
  await page.getByRole("button", { name: "Categories", exact: true }).click();
  await manager.getByLabel("Name", { exact: true }).fill("Custom category");
  await manager.getByRole("button", { name: "rose", exact: true }).click();
  await manager.getByRole("button", { name: "Save category", exact: true }).click();
  await manager.getByRole("button", { name: /Custom category/ }).waitFor();
  await manager.getByRole("button", { name: /Custom category/ }).click();
  await manager.getByLabel("Name", { exact: true }).fill("Renamed category");
  await manager.getByRole("button", { name: "Save category", exact: true }).click();
  await manager.getByRole("button", { name: /Renamed category/ }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await manager.evaluate(e => e.scrollWidth > e.clientWidth), false);
  await page.screenshot({ path: path.join(output, "categories-mobile.png") });
  assert.equal(ai, 0); assert.equal(errors.length, 0, errors.join("\n"));
  console.log(`Category browser passed: assign, clear, failed save retained, shared recolor, create, rename, accessible swatches, mobile overflow; ${writes} fixture writes, zero AI/DB calls.`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
