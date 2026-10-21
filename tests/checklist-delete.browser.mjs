// Actual Board/Drawer with mocked server actions; no production DB or AI calls.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import path from "node:path";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = process.cwd();
const bundled = await build({ entryPoints: ["tests/fixtures/checklist-delete-harness.tsx"], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "fixture-actions", setup(b) { b.onResolve({ filter: /^@\/lib\/actions\/object-actions$/ }, () => ({ path: path.join(root, "tests/fixtures/ui-actions.ts") })); } }] });
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/app.js" ? bundled.outputFiles[0].text : '<html><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  const errors = []; let aiCalls = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = route.request().url(); if (url.includes("/api/ai/")) aiCalls++;
    const body = url.endsWith("/categories") ? { categories: [] } : url.endsWith("/activity") ? { updates: [] } : url.endsWith("/tables") ? { tables: [] } : url.endsWith("/upcoming") ? { occurrences: [] } : {};
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Open Object: Checklist deletion regression", exact: true }).first().click();
  const drawer = page.getByRole("dialog", { name: "Object details" });
  const checklist = drawer.getByRole("region", { name: "Checklist", exact: true });
  await checklist.getByText("1 / 19", { exact: true }).waitFor();
  // A failed save must restore the whole subtree and its original count.
  await page.evaluate(() => { window.uiFixture.failNext = true; });
  await checklist.getByRole("button", { name: "Delete Deleted parent", exact: true }).click();
  await checklist.getByRole("alert").waitFor();
  await checklist.getByText("1 / 19", { exact: true }).waitFor();
  await checklist.getByRole("button", { name: "Delete Deleted parent", exact: true }).click();
  await checklist.getByText("1 / 7", { exact: true }).waitFor();
  await page.waitForFunction(() => window.uiFixture.objects[0].checklist.length === 7);
  await page.getByText("Saving…", { exact: true }).waitFor({ state: "detached" });
  assert.equal(await checklist.getByRole("checkbox").count(), 6);
  await checklist.getByRole("button", { name: "Completed (1)", exact: true }).click();
  assert.equal(await checklist.getByRole("checkbox").count(), 7);
  await drawer.getByRole("button", { name: "Close Object Drawer", exact: true }).click();
  await page.getByRole("button", { name: "Open Object: Checklist deletion regression", exact: true }).first().click();
  await page.getByRole("region", { name: "Checklist", exact: true }).getByText("1 / 7", { exact: true }).waitFor();
  assert.deepEqual(errors, []); assert.equal(aiCalls, 0);
  console.log("Checklist deletion browser regression passed: parent cascade, 1/7 progress, collapsed completed items, rollback and reopening; zero AI calls.");
} finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
