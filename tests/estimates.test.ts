import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as schema from "@/lib/db/schema";
import { parseEstimatedDuration, formatEstimatedDuration, summarizeEstimates, validateEstimatedMinutes } from "@/lib/estimates/time";
import { estimateSnapshot, validateEstimateOutput, type EstimateProposal } from "@/lib/estimates/model";
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mocks = vi.hoisted(() => ({ auth: vi.fn(), openai: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/db/index", () => ({ getDb: () => db }));
vi.mock("@/lib/auth/require-auth", () => ({ requireAuth: mocks.auth, UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: mocks.openai }));
import { UnauthorizedError } from "@/lib/auth/require-auth";
import { createObject, getObject, updateObjectStatus, updateObjectRecurrence, updateChecklistItem, createChecklistItem, deleteChecklistItem } from "@/lib/db/queries";
import { updateChecklistEstimate, applyTimeEstimates } from "@/lib/db/estimates";
import { changeObjectLifecycle } from "@/lib/db/archive";
import { getExportRows } from "@/lib/db/export";
import { buildJSONExport, buildCSVExport } from "@/lib/portability/export";
import { POST as analyze } from "@/app/api/ai/objects/[objectId]/estimate-time/analyze/route";
import { POST as apply } from "@/app/api/ai/objects/[objectId]/estimate-time/apply/route";
import { PATCH as manual } from "@/app/api/objects/[objectId]/checklist-estimate/route";
import { CardBody } from "@/components/board/ObjectCard";
import { TimeEstimates, EstimateSummary } from "@/components/ai/TimeEstimates";
import type { ChecklistItem } from "@/lib/types/object";

beforeAll(async () => {
  pg = new PGlite(); db = drizzle(pg, { schema });
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) {
    if (entry.idx === 10) {
      await pg.exec("INSERT INTO objects(id,title) VALUES ('legacy','Old Object'); INSERT INTO checklist_items(id,object_id,title) VALUES ('legacy-item','legacy','Old step')");
    }
    await pg.exec(await readFile(`drizzle/${entry.tag}.sql`, "utf8"));
  }
  const legacy = await getObject("legacy");
  expect(legacy?.checklist[0].estimatedMinutes).toBeNull();
}, 30000);
beforeEach(async () => { await pg.exec("TRUNCATE objects CASCADE"); mocks.auth.mockReset().mockResolvedValue({}); mocks.create.mockReset(); mocks.openai.mockReset().mockReturnValue({ responses: { create: mocks.create } }); });
afterAll(async () => { await pg.close(); });
const leaf = (id: string, estimatedMinutes: number | null, completed = false, parentId: string | null = null): ChecklistItem => ({ id, title: id, estimatedMinutes, completed, parentId, position: 0 });
const request = (body: unknown, method = "POST") => new Request("http://app.test/estimates", { method, body: JSON.stringify(body) });
const context = (objectId: string) => ({ params: Promise.resolve({ objectId }) });
async function make() { return createObject({ title: "Build Life Assistant", goal: "Working reminders", checklist: [{ title: "Implement", completed: false }, { title: "Test", completed: true }] }); }
async function proposal(id: string, mode: "missing" | "all" = "missing"): Promise<EstimateProposal> {
  const object = (await getObject(id))!;
  return { mode, snapshot: estimateSnapshot(object.checklist), warning: null, estimates: object.checklist.filter((item) => mode === "all" || item.estimatedMinutes == null).map((item) => ({ checklistItemId: item.id, estimatedMinutes: 30 })) };
}
describe("duration validation and parsing", () => {
  it.each([null, 1, 15, 90, 525600])("accepts %s", (value) => expect(validateEstimatedMinutes(value)).toBe(value));
  it.each([0, -1, 1.5, 525601, NaN, Infinity, "30"])("rejects %s", (value) => expect(() => validateEstimatedMinutes(value)).toThrow());
  it.each([["15m", 15], ["90m", 90], ["1h", 60], ["1h 30m", 90], ["2h", 120], ["  1H   30M  ", 90]])("parses %s", (value, minutes) => expect(parseEstimatedDuration(value as string)).toBe(minutes));
  it.each(["garbage", "90", "1.5h", "-1m", "1h x", "0m", "99999999h", "1m 2h", ""]) ("rejects ambiguous/invalid %s", (value) => expect(() => parseEstimatedDuration(value)).toThrow());
  it("clears only with explicit permission and round trips", () => {
    expect(parseEstimatedDuration("  ", { allowClear: true })).toBeNull();
    for (const minutes of [15, 90, 120, 525600]) expect(parseEstimatedDuration(formatEstimatedDuration(minutes))).toBe(minutes);
    expect(formatEstimatedDuration(null)).toBe("—");
  });
});
describe("leaf effort aggregation", () => {
  it("distinguishes no estimates from a zero remaining subtotal", () => {
    expect(summarizeEstimates([leaf("a", null)])).toMatchObject({ hasEstimates: false, unestimatedCount: 1 });
    expect(summarizeEstimates([leaf("a", 30, true)])).toMatchObject({ hasEstimates: true, estimatedRemainingMinutes: 0 });
  });
  it("does not double count parents and reports partial estimates", () => {
    expect(summarizeEstimates([leaf("p", 1000), leaf("a", 45, true, "p"), leaf("b", 20, false, "p"), leaf("c", null)])).toEqual({ hasEstimates: true, estimatedTotalMinutes: 65, estimatedDoneMinutes: 45, estimatedRemainingMinutes: 20, unestimatedCount: 1 });
  });
  it("moves remaining to done without changing total", () => {
    expect(summarizeEstimates([leaf("a", 30, true)])).toMatchObject({ estimatedTotalMinutes: 30, estimatedDoneMinutes: 30, estimatedRemainingMinutes: 0 });
  });
});
describe("estimate persistence / proposals", () => {
  it("creates Objects and checklist without estimates and supports set/clear", async () => {
    const object = await make(); expect(object.checklist.every((item) => item.estimatedMinutes === null)).toBe(true);
    await updateChecklistEstimate(object.id, object.checklist[0].id, 90);
    expect((await getObject(object.id))!.checklist[0].estimatedMinutes).toBe(90);
    await updateChecklistEstimate(object.id, object.checklist[0].id, null);
    expect((await getObject(object.id))!.checklist[0].estimatedMinutes).toBeNull();
  });
  it.each([0, -1, 1.2, 525601])("rejects invalid manual minutes %s without changes", async (minutes) => {
    const object = await make(); await expect(updateChecklistEstimate(object.id, object.checklist[0].id, minutes)).rejects.toThrow();
    expect(await getObject(object.id)).toEqual(object);
  });
  it("analyzes only missing leaves, sends limited context and performs no writes", async () => {
    const object = await createObject({ title: "O", checklist: [{ title: "Phase", completed: false, children: [{ title: "A", completed: false }, { title: "B", completed: false }] }] });
    const child = object.checklist.find((item) => item.title === "A")!;
    await updateChecklistEstimate(object.id, child.id, 15);
    const before = (await getObject(object.id))!;
    const target = before.checklist.find((item) => item.title === "B")!;
    mocks.create.mockResolvedValue({ output_text: JSON.stringify({ estimates: [{ checklistItemId: target.id, estimatedMinutes: 60 }], warning: null }) });
    const result = await analyze(request({}), context(object.id)); expect(result.status).toBe(200);
    const input = JSON.parse(mocks.create.mock.calls[0][0].input[1].content);
    expect(input.targetChecklistItemIds).toEqual([target.id]);
    expect(input).not.toHaveProperty("recentUpdates"); expect(input).not.toHaveProperty("tables");
    expect(await getObject(object.id)).toEqual(before);
    const reviewed = (await result.json()).proposal;
    expect(reviewed.mode).toBe("missing");
    await applyTimeEstimates(object.id, reviewed);
    expect((await getObject(object.id))!.checklist.find((item) => item.id === child.id)?.estimatedMinutes).toBe(15);
  });
  it.each(["unknown", "duplicate", "invalid-minutes", "extra-fields"])("rejects AI %s and does not write", async (kind) => {
    const object = await make(); const entry = { checklistItemId: object.checklist[0].id, estimatedMinutes: 30 };
    const output = { estimates: kind === "duplicate" ? [entry, entry] : [{ ...entry, ...(kind === "unknown" ? { checklistItemId: "foreign" } : kind === "invalid-minutes" ? { estimatedMinutes: 0 } : {}) }], warning: null, ...(kind === "extra-fields" ? { currentState: "hacked" } : {}) };
    mocks.create.mockResolvedValue({ output_text: JSON.stringify(output) });
    expect((await analyze(request({}), context(object.id))).status).toBe(502);
    expect(await getObject(object.id)).toEqual(object);
  });
  it("rejects parent estimates, duplicates, and overwriting in missing mode", () => {
    const items = [leaf("p", null), leaf("c", null, false, "p"), leaf("existing", 15)];
    for (const id of ["p", "existing", "foreign"]) expect(() => validateEstimateOutput({ estimates: [{ checklistItemId: id, estimatedMinutes: 30 }], warning: null }, items, "missing")).toThrow();
    expect(() => validateEstimateOutput({ estimates: [{ checklistItemId: "c", estimatedMinutes: 30 }, { checklistItemId: "c", estimatedMinutes: 45 }], warning: null }, items, "missing")).toThrow();
  });
  it("skips AI for empty checklist and already estimated missing targets", async () => {
    const empty = await createObject({ title: "Empty" }); expect((await analyze(request({}), context(empty.id))).status).toBe(400);
    const object = await make(); for (const item of object.checklist) await updateChecklistEstimate(object.id, item.id, 15);
    expect((await analyze(request({ mode: "missing" }), context(object.id))).status).toBe(200);
    expect(mocks.openai).not.toHaveBeenCalled();
  });
  it("provider failure leaves Object intact", async () => {
    const object = await make(); mocks.create.mockRejectedValue({ status: 429 });
    expect((await analyze(request({}), context(object.id))).status).toBe(429); expect(await getObject(object.id)).toEqual(object);
  });
  it("confirmed apply changes only estimates and records one activity", async () => {
    const object = await make(); const p = await proposal(object.id);
    const response = await apply(request({ proposal: p }), context(object.id)); expect(response.status).toBe(200);
    const saved = (await getObject(object.id))!;
    expect(saved).toEqual({ ...object, checklist: object.checklist.map((item) => ({ ...item, estimatedMinutes: 30 })) });
    expect((await db.select().from(schema.objectUpdates).where(eq(schema.objectUpdates.objectId, object.id))).filter((row) => row.type === "time_estimates_applied")).toHaveLength(1);
  });
  it.each(["delete", "rename", "hierarchy", "estimate", "completion"])("rejects stale %s transactionally", async (change) => {
    const object = await make(); const p = await proposal(object.id); const id = object.checklist[1].id;
    if (change === "delete") await deleteChecklistItem(id, object.id);
    if (change === "rename") await db.update(schema.checklistItems).set({ title: "Changed" }).where(eq(schema.checklistItems.id, id));
    if (change === "hierarchy") await createChecklistItem(object.id, "Child", id);
    if (change === "estimate") await updateChecklistEstimate(object.id, id, 15);
    if (change === "completion") await updateChecklistItem(id, false);
    const before = await getObject(object.id);
    await expect(applyTimeEstimates(object.id, p)).rejects.toThrow("changed after this preview");
    expect(await getObject(object.id)).toEqual(before);
  });
  it("all mode explicitly replaces existing estimates after apply", async () => {
    const object = await make(); await updateChecklistEstimate(object.id, object.checklist[0].id, 15);
    const p = await proposal(object.id, "all");
    expect((await getObject(object.id))!.checklist[0].estimatedMinutes).toBe(15);
    await applyTimeEstimates(object.id, p); expect((await getObject(object.id))!.checklist[0].estimatedMinutes).toBe(30);
  });
  it.each(["archive", "cancel"] as const)("preserves estimates on %s/restore and rejects editing", async (action) => {
    const object = await make(); await updateChecklistEstimate(object.id, object.checklist[0].id, 45); const p = await proposal(object.id, "all");
    await changeObjectLifecycle(object.id, action);
    await expect(applyTimeEstimates(object.id, p)).rejects.toThrow("Restore");
    await expect(updateChecklistEstimate(object.id, object.checklist[0].id, null)).rejects.toThrow("Restore");
    const restored = await changeObjectLifecycle(object.id, "restore"); expect(restored.checklist[0].estimatedMinutes).toBe(45);
  });
  it("copies recurring hierarchy and estimates while resetting completion", async () => {
    const object = await createObject({ title: "O", checklist: [{ title: "Phase", completed: false, children: [{ title: "Child", completed: true }] }] });
    const child = object.checklist.find((item) => item.parentId)!;
    await updateChecklistEstimate(object.id, child.id, 45);
    await updateObjectRecurrence(object.id, { frequency: "weekly", interval: 1, basis: "completion_date", nextDate: null });
    await updateObjectStatus(object.id, "done");
    const current = (await getObject(object.id))!; const next = (await getObject(current.recurrence!.nextOccurrenceId!))!;
    expect(next.checklist.find((item) => item.parentId)?.estimatedMinutes).toBe(45);
    expect(next.checklist.every((item) => !item.completed)).toBe(true);
    expect(next.checklist.find((item) => item.parentId)?.parentId).toBe(next.checklist.find((item) => !item.parentId)?.id);
  });
  it("preserves a parent's old estimate but excludes it when children are added", async () => {
    const object = await make(); const parent = object.checklist[0];
    await updateChecklistEstimate(object.id, parent.id, 120);
    const child = await createChecklistItem(object.id, "Child", parent.id);
    await updateChecklistEstimate(object.id, child.id, 15);
    const saved = (await getObject(object.id))!;
    expect(saved.checklist.find((item) => item.id === parent.id)?.estimatedMinutes).toBe(120);
    expect(summarizeEstimates(saved.checklist).estimatedTotalMinutes).toBe(15);
    await expect(updateChecklistEstimate(object.id, parent.id, 30)).rejects.toThrow("leaf");
  });
  it("completion retains estimated minutes and changes derived done effort", async () => {
    const object = await make(); await updateChecklistEstimate(object.id, object.checklist[0].id, 90);
    await updateChecklistItem(object.checklist[0].id, true);
    const saved = (await getObject(object.id))!;
    expect(saved.checklist[0].estimatedMinutes).toBe(90);
    expect(summarizeEstimates(saved.checklist)).toMatchObject({ estimatedTotalMinutes: 90, estimatedDoneMinutes: 90, estimatedRemainingMinutes: 0 });
  });
  it("manual API supports set/clear and rejects cross-Object and invalid requests", async () => {
    const object = await make(); const other = await make(); const itemId = object.checklist[0].id;
    expect((await manual(request({ itemId, estimatedMinutes: 15 }, "PATCH"), context(object.id))).status).toBe(200);
    expect((await getObject(object.id))!.checklist[0].estimatedMinutes).toBe(15);
    expect((await manual(request({ itemId, estimatedMinutes: null }, "PATCH"), context(object.id))).status).toBe(200);
    expect((await getObject(object.id))!.checklist[0].estimatedMinutes).toBeNull();
    expect((await manual(request({ itemId, estimatedMinutes: 0 }, "PATCH"), context(object.id))).status).toBe(400);
    expect((await manual(request({ itemId, estimatedMinutes: 15 }, "PATCH"), context(other.id))).status).toBe(400);
  });
  it("re-estimate all targets both existing and missing estimates without writing", async () => {
    const object = await make(); await updateChecklistEstimate(object.id, object.checklist[0].id, 15);
    const before = (await getObject(object.id))!;
    mocks.create.mockResolvedValue({ output_text: JSON.stringify({ estimates: before.checklist.map((item) => ({ checklistItemId: item.id, estimatedMinutes: 120 })), warning: null }) });
    const result = await analyze(request({ mode: "all" }), context(object.id)); expect(result.status).toBe(200);
    expect(JSON.parse(mocks.create.mock.calls[0][0].input[1].content).targetChecklistItemIds).toHaveLength(2);
    expect(await getObject(object.id)).toEqual(before);
    expect(mocks.create.mock.calls[0][0].text.format.schema.properties.estimates.items.properties.checklistItemId.enum).toEqual(before.checklist.map((item) => item.id));
  });
  it("a current snapshot cannot bypass missing-mode overwrite protection", async () => {
    const object = await make(); await updateChecklistEstimate(object.id, object.checklist[0].id, 15);
    const p = await proposal(object.id, "all"); p.mode = "missing";
    const before = await getObject(object.id);
    await expect(applyTimeEstimates(object.id, p)).rejects.toThrow("already estimated");
    expect(await getObject(object.id)).toEqual(before);
  });
  it("an invalid final row rejects the whole batch and does not add history", async () => {
    const object = await make(); const p = await proposal(object.id); p.estimates[1].estimatedMinutes = -1;
    const updates = await db.select().from(schema.objectUpdates);
    expect((await apply(request({ proposal: p }), context(object.id))).status).toBe(400);
    expect(await getObject(object.id)).toEqual(object); expect(await db.select().from(schema.objectUpdates)).toEqual(updates);
  });
  it("includes nullable estimates in JSON and additive CSV export", async () => {
    const object = await make(); await updateChecklistEstimate(object.id, object.checklist[0].id, 45);
    const rows = await getExportRows(); expect(buildJSONExport(rows).checklistItems.map((item) => item.estimatedMinutes)).toContain(45);
    expect(buildCSVExport(rows)).toContain("checklist_estimates_json");
  });
  it("authentication blocks all new boundaries before DB or AI", async () => {
    for (const route of [analyze, apply, manual]) { mocks.auth.mockRejectedValueOnce(new UnauthorizedError()); expect((await route(request({}), context("missing"))).status).toBe(401); }
    expect(mocks.openai).not.toHaveBeenCalled();
  });
});
describe("estimate UI", () => {
  it("hides unestimated card effort, shows remaining and partial count", async () => {
    const object = await make(); expect(renderToStaticMarkup(createElement(CardBody, { object }))).not.toContain("⏱");
    const estimated = { ...object, checklist: object.checklist.map((item, index) => ({ ...item, estimatedMinutes: index ? null : 90 })) };
    const markup = renderToStaticMarkup(createElement(CardBody, { object: estimated, onEstimateApplied: vi.fn() })); expect(markup).toContain("⏱ ≈ 1h 30m"); expect(markup).toContain("Estimated remaining ≈ 1h 30m");
  });
  it("summary returns no misleading zero for an unestimated Object", () => expect(renderToStaticMarkup(createElement(EstimateSummary, { items: [leaf("a", null)] }))).toBe(""));
  it("offers Card estimation when minimized, hides it on empty or historical cards", async () => {
    const object = await make();
    const render = (value = object) => renderToStaticMarkup(createElement(CardBody, { object: value, minimized: true, onEstimateApplied: vi.fn() }));
    expect(render()).toContain(`Estimate time: ${object.title}`);
    expect(render({ ...object, checklist: [] })).not.toContain("Estimate time:");
    expect(render({ ...object, archivedAt: new Date().toISOString() })).not.toContain("Estimate time:");
    expect(render({ ...object, cancelledAt: new Date().toISOString() })).not.toContain("Estimate time:");
  });
  it("displays remaining rather than total, retains partial-estimate warning", async () => {
    const object = await make();
    const estimated = { ...object, checklist: object.checklist.map((item, index) => ({ ...item, completed: index === 0, estimatedMinutes: index ? 45 : 90 })) };
    const markup = renderToStaticMarkup(createElement(CardBody, { object: estimated, minimized: true, onEstimateApplied: vi.fn() }));
    expect(markup).toContain("⏱ ≈ 45m");
    expect(markup).toContain("Estimated remaining ≈ 45m");
    expect(markup).not.toContain("Estimated Time · optional");
  });
  it("offers explicit AI missing/all actions and no fixed-width input", async () => {
    const object = await make(); const markup = renderToStaticMarkup(createElement(TimeEstimates, { object, disabled: false, onPendingChange: vi.fn() }));
    expect(markup).toContain("Estimate time with AI"); expect(markup).toContain("Re-estimate all"); expect(markup).toContain("flex-wrap"); expect(markup).not.toContain("≈ 0m");
  });
});