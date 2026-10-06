// Isolated browser coverage: real components/CSS, mocked API; no database or AI calls.
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
const bundled = await build({ entryPoints: ["tests/fixtures/workspace-features-harness.tsx"], absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const files = await readdir(path.join(root, ".next/static"), { recursive: true });
const css = (await Promise.all(files.filter((file) => file.endsWith(".css")).map((file) => readFile(path.join(root, ".next/static", file), "utf8")))).join("\n");
const server = createServer((request, response) => {
  if (request.url === "/app.js") { response.setHeader("content-type", "text/javascript"); response.end(bundled.outputFiles[0].text); }
  else if (request.url === "/app.css") { response.setHeader("content-type", "text/css"); response.end(css); }
  else { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const table = {
  id: "table-1", objectId: "workspace-fixture", title: "Desk materials", position: 0,
  columns: [{ id: "col-1", name: "Material", type: "text", currency: null, carryForward: false, position: 0 }],
  rows: [{ id: "row-1", position: 0, carryForward: false, cells: { "col-1": "Pine wood" } }],
};
const dependencies = { blockedBy: [{ objectId: "other", title: "Get workshop access", status: "waiting", resolved: false }], blocking: [] };
try {
  for (const width of [1440, 375, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let storedTables = [];
    let storedDeps = { blockedBy: [], blocking: [] };
    let failLoading = false;
    let currentObject;
    const requests = [];
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = request.url();
      requests.push({ url, method: request.method() });
      const second = url.includes("second-object");
      if (failLoading && /\/(tables|dependencies)$/.test(url)) {
        await route.fulfill({ status: 500, contentType: "application/json", body: "{}" }); return;
      }
      let body;
      if (url.endsWith("/replan/analyze")) {
        body = { proposal: { title: null, goal: null, currentState: "Dimensions confirmed", reasonSummary: "Propose a table", checklistMode: "preserve", checklist: [], removedItemIds: [], tablesToAdd: [{ title: "电脑部件检查表格", columns: [{ name: "部件", type: "text", currency: null, carryForward: false }, { name: "已检查", type: "checkbox", currency: null, carryForward: false }], rows: [{ carryForward: false, cells: ["内存", "false"] }] }], summary: "Awaiting confirmation" } };
      } else if (url.endsWith("/replan/apply")) {
        storedTables = [{ ...table, title: "电脑部件检查表格" }]; body = { object: currentObject };
      } else if (url.endsWith("/objects/workspace-fixture")) {
        body = { object: currentObject };
      } else if (url.endsWith("/tables") && request.method() === "POST") {
        storedTables = [table]; body = { table };
      } else if (url.endsWith("/tables")) body = { tables: second ? [] : storedTables };
      else if (url.endsWith("/dependencies")) body = { dependencies: second ? { blockedBy: [], blocking: [] } : storedDeps };
      else if (url.endsWith("/activity")) body = { updates: [] };
      else if (url.endsWith("/categories")) body = { categories: [] };
      else throw new Error(`Unexpected API request: ${url}`);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const dialog = page.getByRole("dialog", { name: "Object details", exact: true });
    const content = dialog.getByLabel("Object content", { exact: true });
    await content.getByLabel("Checklist", { exact: true }).waitFor();
    for (const feature of ["Note", "Time estimates", "Table", "Dependency", "Recurring"]) await dialog.getByRole("button", { name: `Add ${feature}`, exact: true }).waitFor();
    for (const label of ["Estimated Time", "Tables", "Dependencies", "Recurring"]) assert.equal(await dialog.getByLabel(label, { exact: true }).count(), 0);
    assert.equal(await dialog.getByText("Occurrence note", { exact: true }).count(), 0);
    await page.screenshot({ path: path.join(output, `workspace-clean-${width}.png`) });

    await dialog.getByRole("button", { name: "Add Note", exact: true }).click();
    await dialog.getByRole("button", { name: "Edit Occurrence note", exact: true }).click();
    await dialog.getByLabel("Occurrence note", { exact: true }).fill("Use the pine wood already bought.");
    await content.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.getByText("Use the pine wood already bought.", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Add Time estimates", exact: true }).click();
    await dialog.getByLabel("Estimated Time", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Add Recurring", exact: true }).click();
    await dialog.getByLabel("Recurring", { exact: true }).getByRole("button", { name: "+ Make recurring", exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Add Dependency", exact: true }).click();
    await dialog.getByLabel("Dependencies", { exact: true }).getByRole("button", { name: "+ Add dependency", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Search Objects", exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Add Table", exact: true }).click();
    await dialog.getByLabel("Tables", { exact: true }).getByRole("button", { name: "+ Add table", exact: true }).click();
    const addTable = page.getByRole("dialog", { name: "Add table", exact: true });
    await addTable.getByRole("textbox", { name: "Table title" }).fill("Desk materials");
    await addTable.getByRole("button", { name: "Create table", exact: true }).click();
    await dialog.getByRole("button", { name: "Collapse table Desk materials", exact: true }).waitFor();
    assert.equal(requests.some((request) => request.url.includes("/api/ai/")), false, "revealing tools never calls AI");
    assert.equal(requests.filter((request) => request.method !== "GET").length, 1, "only explicit table confirmation writes");

    await dialog.getByRole("button", { name: "Close Object Drawer", exact: true }).click();
    storedDeps = dependencies;
    await page.getByRole("button", { name: "Open workspace", exact: true }).click();
    await dialog.getByRole("button", { name: "Collapse table Desk materials", exact: true }).waitFor();
    await dialog.getByText("Get workshop access", { exact: true }).waitFor();
    await dialog.getByText("Use the pine wood already bought.", { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Add Table", exact: true }).count(), 0);
    assert.equal(await dialog.getByRole("button", { name: "Add Dependency", exact: true }).count(), 0);
    assert.equal(await dialog.getByLabel("Estimated Time", { exact: true }).count(), 0, "unused reveal state is not persisted");
    assert.equal(await dialog.getByLabel("Recurring", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth), false);
    if (width < 1024) {
      const scrolls = await dialog.evaluate((element) => [...element.querySelectorAll("*")].filter((child) => /auto|scroll/.test(getComputedStyle(child).overflowY) && child.scrollHeight > child.clientHeight + 1).length);
      assert.equal(scrolls, 1, "single primary mobile scroll");
    }
    await page.screenshot({ path: path.join(output, `workspace-used-${width}.png`) });

    await dialog.getByRole("button", { name: "Close Object Drawer", exact: true }).click();
    await page.getByRole("button", { name: "Switch Object fixture", exact: true }).click();
    await page.getByRole("button", { name: "Open workspace", exact: true }).click();
    await dialog.getByText("Make a video", { exact: true }).waitFor();
    assert.equal(await dialog.getByLabel("Tables", { exact: true }).count(), 0, "previous Object content must not leak");
    assert.equal(await dialog.getByLabel("Dependencies", { exact: true }).count(), 0);
    await dialog.getByRole("button", { name: "Close Object Drawer", exact: true }).click();

    // A table added outside this section (e.g. Replan) appears after the refresh token changes.
    await page.reload();
    await dialog.getByRole("button", { name: "Collapse table Desk materials", exact: true }).waitFor();
    storedTables = [];
    await dialog.getByRole("button", { name: "Close Object Drawer", exact: true }).click();
    await page.getByRole("button", { name: "Open workspace", exact: true }).click();
    await dialog.getByRole("button", { name: "Add Table", exact: true }).waitFor();
    storedTables = [table];
    await page.evaluate(() => document.querySelectorAll("button").forEach((button) => { if (button.textContent === "Refresh tables fixture") button.click(); }));
    await dialog.getByRole("button", { name: "Collapse table Desk materials", exact: true }).waitFor();

    // Load failures remain visible even if the tools were never opened.
    failLoading = true;
    await dialog.getByRole("button", { name: "Close Object Drawer", exact: true }).click();
    await page.getByRole("button", { name: "Open workspace", exact: true }).click();
    await dialog.getByText("Could not load tables.", { exact: true }).waitFor();
    await dialog.getByText("Could not load dependencies.", { exact: true }).waitFor();

    // The actual AI preview focuses on the table and Apply refreshes the previously hidden tool.
    failLoading = false; storedTables = []; storedDeps = { blockedBy: [], blocking: [] };
    await page.reload();
    await dialog.getByRole("button", { name: "Add Table", exact: true }).waitFor();
    currentObject = { id: "workspace-fixture", title: "Make a desk", goal: "Build a wooden computer desk", status: "doing", position: 0, category: null, archivedAt: null, cancelledAt: null, currentState: "Dimensions confirmed", nextAction: "Choose wood", occurrenceNote: null, recurrence: null, unresolvedDependencies: 0, checklist: [{ id: "step-1", title: "Choose wood", parentId: null, completed: false, position: 0, estimatedMinutes: null }] };
    await dialog.getByRole("button", { name: "Replan", exact: true }).click();
    await dialog.getByLabel("What changed?", { exact: true }).fill("新增表格：电脑部件检查表格");
    await dialog.getByRole("button", { name: "Analyze Replan", exact: true }).click();
    await dialog.getByText("Review replan", { exact: true }).waitFor();
    await dialog.getByText("New tables", { exact: true }).waitFor();
    assert.equal(await dialog.getByText("Checklist changes", { exact: true }).count(), 0);
    assert.equal(storedTables.length, 0, "Analyze does not save the table");
    await page.screenshot({ path: path.join(output, `replan-table-preview-${width}.png`) });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(storedTables.length, 0, "Cancel does not save the table");
    await dialog.getByRole("button", { name: "Analyze Replan", exact: true }).click();
    await dialog.getByRole("button", { name: "Apply Replan", exact: true }).click();
    await dialog.getByRole("button", { name: "Collapse table 电脑部件检查表格", exact: true }).waitFor();
    await dialog.getByText("Dimensions confirmed", { exact: true }).waitFor();
    assert.equal(await dialog.getByLabel("Checklist", { exact: true }).getByText("Choose wood", { exact: true }).count(), 1);
    assert.equal(await dialog.getByRole("button", { name: "Add Table", exact: true }).count(), 0);
    assert.equal(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth), false);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Workspace features passed at 1440/375/390px: empty-tool hiding, entry points, saved content, remount/reset, cross-Object isolation, external table refresh, visible failures, Replan table analyze/cancel/apply/refresh and overflow. No live DB/provider writes.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}