// Isolated real-browser validation: no live DB or provider requests.
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
const bundled = await build({ entryPoints: ["tests/fixtures/estimates-harness.tsx"], absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
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
  for (const width of [1440, 375, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const modes = [];
    let failCardApply = false;
    await page.route("**/api/**", async (route) => {
      const url = route.request().url(); const payload = route.request().postDataJSON();
      const current = await page.evaluate(() => window.estimateFixture);
      let body;
      if (url.endsWith("/checklist-estimate")) {
        body = { object: { ...current, checklist: current.checklist.map((item) => item.id === payload.itemId ? { ...item, estimatedMinutes: payload.estimatedMinutes } : item) } };
      } else if (url.endsWith("/estimate-time/analyze")) {
        modes.push(payload.mode);
        body = { proposal: { mode: payload.mode, snapshot: current.checklist, warning: null, estimates: current.checklist.filter((item) => payload.mode === "all" || item.estimatedMinutes === null).map((item) => ({ checklistItemId: item.id, estimatedMinutes: 45 })) } };
      } else if (url.endsWith("/estimate-time/apply")) {
        if (failCardApply) { failCardApply = false; await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "UPDATE_CONFLICT", message: "Simulated stale estimate", requestId: "fixture-request" } }) }); return; }
        body = { object: { ...current, checklist: current.checklist.map((item) => { const estimate = payload.proposal.estimates.find((estimate) => estimate.checklistItemId === item.id); return estimate ? { ...item, estimatedMinutes: estimate.estimatedMinutes } : item; }) } };
      } else if (url.endsWith("/activity")) body = { updates: [] };
      else if (url.endsWith("/tables")) body = { tables: [] };
      else if (url.endsWith("/dependencies")) body = { dependsOn: [], blocking: [] };
      else if (url.endsWith("/categories")) body = { categories: [] };
      else throw new Error(`Unexpected API: ${url}`);
      if (body.object) await page.evaluate((object) => { window.estimateFixture = object; window.estimateWrites++; }, body.object);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const dialog = page.getByRole("dialog"); await dialog.waitFor();
    await dialog.getByRole("button", { name: "Add Time estimates", exact: true }).click();
    const section = dialog.getByLabel("Estimated Time", { exact: true });
    assert.equal(await section.getByText("≈ 0m", { exact: true }).count(), 0);
    await dialog.getByRole("button", { name: "Edit estimate: Implement API", exact: true }).click();
    await dialog.getByLabel("Estimated duration: Implement API", { exact: true }).fill("garbage");
    await dialog.getByRole("button", { name: "Save estimate", exact: true }).click();
    await dialog.getByText("Use a duration such as 15m, 1h, or 1h 30m.").waitFor();
    assert.equal(await page.evaluate(() => window.estimateWrites), 0);
    await dialog.getByLabel("Estimated duration: Implement API", { exact: true }).fill("1h 30m");
    assert.equal(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth), false, "manual editor does not overflow");
    await dialog.getByRole("button", { name: "Save estimate", exact: true }).click();
    await section.getByText("1 items unestimated — totals cover estimated steps only.").waitFor();
    assert.equal(await page.evaluate(() => window.estimateFixture.checklist[0].estimatedMinutes), 90);
    await dialog.getByRole("button", { name: "Edit estimate: Implement API", exact: true }).click();
    await dialog.getByRole("button", { name: "Clear estimate", exact: true }).click();
    await page.waitForFunction(() => window.estimateFixture.checklist[0].estimatedMinutes === null);
    await section.getByRole("button", { name: "✨ Estimate time with AI", exact: true }).click();
    await section.getByText("Review AI time estimates", { exact: true }).waitFor();
    const writes = await page.evaluate(() => window.estimateWrites);
    await section.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.evaluate(() => window.estimateWrites), writes);
    await section.getByRole("button", { name: "✨ Estimate time with AI", exact: true }).click();
    await section.getByText("Review AI time estimates", { exact: true }).waitFor();
    await section.getByRole("button", { name: "Edit estimate: Proposal a", exact: true }).click();
    await section.getByLabel("Estimated duration: Proposal a", { exact: true }).fill("2h");
    assert.equal(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth), false, "proposal editor does not overflow");
    await section.getByRole("button", { name: "Save estimate", exact: true }).click();
    assert.equal(await page.evaluate(() => window.estimateWrites), writes);
    await section.getByRole("button", { name: "Apply estimates", exact: true }).click();
    await page.waitForFunction(() => window.estimateFixture.checklist[0].estimatedMinutes === 120);
    await section.getByRole("button", { name: "Re-estimate all", exact: true }).click();
    await section.getByText(/Re-estimate All — applying may replace existing estimates/).waitFor();
    assert.equal(modes.at(-1), "all");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth), false);
    if (width < 1024) {
      const scrolls = await dialog.evaluate((element) => [...element.querySelectorAll("*")].filter((child) => /auto|scroll/.test(getComputedStyle(child).overflowY) && child.scrollHeight > child.clientHeight + 1).length);
      assert.equal(scrolls, 1, "single primary mobile scroll");
      const target = await section.getByRole("button", { name: "Apply estimates", exact: true }).boundingBox(); assert(target.height >= 44);
    }
    await page.screenshot({ path: path.join(output, `estimate-${width}.png`) });
    await section.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.getByRole("button", { name: /Close/ }).click();
    await page.getByTestId("card").getByRole("button", { name: "Estimate time: Life Assistant 核心框架", exact: true }).waitFor();
    await page.addInitScript(() => { window.cardOnly = true; });
    await page.reload();
    const card = page.getByTestId("card");
    const action = card.getByRole("button", { name: "Estimate time: Life Assistant 核心框架", exact: true });
    await action.waitFor();
    if (width < 1024) { const box = await action.boundingBox(); assert(box.height >= 44); }
    await card.getByRole("button", { name: "Minimize Life Assistant 核心框架", exact: true }).click();
    await action.press("Enter");
    await card.getByLabel("Card estimate preview", { exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0, "estimate keyboard action does not open Workspace");
    assert.equal(await page.evaluate(() => window.estimateWrites), 0, "analyze only proposes");
    await card.getByText("查看步骤", { exact: true }).click();
    await card.getByText("Implement API · ≈ 45m", { exact: true }).waitFor();
    await card.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.evaluate(() => window.estimateWrites), 0, "card Cancel does not write");
    await action.click();
    await card.getByLabel("Card estimate preview", { exact: true }).waitFor();
    failCardApply = true;
    await card.getByRole("button", { name: "Apply", exact: true }).click();
    await card.getByText("Simulated stale estimate", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.estimateWrites), 0);
    await card.getByRole("button", { name: "Apply", exact: true }).click();
    await action.waitFor();
    assert.equal(await action.getAttribute("title"), "Estimated remaining ≈ 1h 30m");
    assert.equal(await page.evaluate(() => window.estimateWrites), 1);
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, `card-estimate-${width}.png`) });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Estimate browser fixtures passed: Workspace and Card analyze/preview/cancel/apply/retry, minimized Card, keyboard isolation, Card total refresh, 375/390/1440 overflow and mobile single scroll. No live DB/provider writes.");
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }