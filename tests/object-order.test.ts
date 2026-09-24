import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mocks = vi.hoisted(() => ({ auth: vi.fn(), openai: vi.fn() }));
vi.mock("@/lib/db/index", () => ({ getDb: () => db }));
vi.mock("@/lib/auth/require-auth", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: mocks.openai }));

import { createObject, getObjects, getObject, reorderObjects, updateObjectField, createChecklistItem, renameChecklistItem, deleteChecklistItem, reorderChecklistItems, updateChecklistItem, updateObjectStatus } from "@/lib/db/queries";
import { createManualObjectAction, reorderObjectsAction } from "@/lib/actions/object-actions";
import { reorderBoardObjects } from "@/lib/objects/board-order";
import type { ManagedObject } from "@/lib/types/object";

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  for (const migration of ["0000_flaky_meggan", "0001_object_archive_metadata", "0002_object_category_presentation", "0003_silent_groot", "0004_keen_diamondback", "0005_boring_quicksilver", "0006_faulty_meteorite", "0007_clever_annihilus","0008_silky_slapstick","0009_loose_skin"]) {
    await pg.exec(await readFile(`drizzle/${migration}.sql`, "utf8"));
  }
}, 30000);

beforeEach(async () => {
  await pg.exec("TRUNCATE objects CASCADE");
  mocks.auth.mockReset();
  mocks.auth.mockResolvedValue({});
  mocks.openai.mockReset();
});

afterAll(async () => { await pg.close(); });

async function object(title: string, status: "ready" | "doing" = "ready") {
  return createObject({ title, status });
}

describe("Object ordering", () => {
  it("saves routine edits without appending Activity and retains real progress without duplicates", async () => {
    const created = await createObject({ title: "Desk" });
    const original = await db.select().from(schema.objectUpdates);
    await updateObjectField(created.id, "title", "New desk");
    await updateObjectField(created.id, "goal", "Build a wooden desk");
    await updateObjectField(created.id, "nextAction", "Measure wood");
    const first = await createChecklistItem(created.id, "Measure");
    const second = await createChecklistItem(created.id, "Cut");
    await renameChecklistItem(first.id, created.id, "Measure wood");
    await reorderChecklistItems(created.id, null, [second.id, first.id]);
    await deleteChecklistItem(second.id, created.id);
    await reorderObjects(created.id, "idea", [created.id]);
    expect(await db.select().from(schema.objectUpdates)).toEqual(original);
    expect(await getObject(created.id)).toMatchObject({ title: "New desk", goal: "Build a wooden desk", nextAction: "Measure wood", checklist: [{ id: first.id, title: "Measure wood" }] });
    await updateObjectStatus(created.id, "doing");
    await updateObjectStatus(created.id, "doing");
    await updateChecklistItem(first.id, true);
    await updateChecklistItem(first.id, true);
    await updateObjectField(created.id, "currentState", "Wood measured");
    await updateObjectField(created.id, "currentState", "Wood measured");
    const updates = await db.select().from(schema.objectUpdates);
    expect(updates.map((row) => row.type)).toEqual(["object_created", "status_changed", "checklist_changed", "object_edited"]);
    expect(updates.at(-1)?.content).toBe("Current State: Wood measured");
    expect(mocks.openai).not.toHaveBeenCalled();
  });

  it("manually creates a title-only Object without inventing completed progress", async () => {
    const created = await createManualObjectAction({ title: "  Make a desk  " });
    expect(created).toMatchObject({ title: "Make a desk", status: "idea", checklist: [], nextAction: "" });
    expect(await getObjects()).toHaveLength(1);
    const history = await db.select().from(schema.objectUpdates);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ objectId: created.id, type: "object_created", content: "Object created manually." });
    expect(mocks.openai).not.toHaveBeenCalled();
  });

  it("preserves manual fields and appends to the chosen column", async () => {
    await object("Existing", "doing");
    const created = await createManualObjectAction({ title: "Desk", status: "doing", goal: "Build a desk", currentState: "Wood purchased", nextAction: "Cut the legs" });
    expect(created).toMatchObject({ status: "doing", position: 1, goal: "Build a desk", currentState: "Wood purchased", nextAction: "Cut the legs" });
  });

  it("rejects unauthorized or invalid manual creation before writing", async () => {
    mocks.auth.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(createManualObjectAction({ title: "Desk" })).rejects.toThrow("Unauthorized");
    for (const input of [{ title: "   " }, { title: "x".repeat(121) }, { title: "Desk", status: "invalid" }, { title: "Desk", nextAction: "x".repeat(501) }, { title: "Desk", activityContent: "Fake history" }]) {
      await expect(createManualObjectAction(input)).rejects.toThrow();
    }
    expect(await getObjects()).toHaveLength(0);
  });

  it("persists normalized same-column positions", async () => {
    const first = await object("First");
    const second = await object("Second");
    const third = await object("Third");
    await reorderObjects(first.id, "ready", [third.id, second.id, first.id]);
    expect((await db.select().from(schema.objectUpdates)).map((row) => row.type)).toEqual(["object_created", "object_created", "object_created"]);
    expect((await getObjects()).filter((item) => item.status === "ready").map(({ id, position }) => ({ id, position }))).toEqual([
      { id: third.id, position: 0 },
      { id: second.id, position: 1 },
      { id: first.id, position: 2 },
    ]);
    expect(mocks.openai).not.toHaveBeenCalled();
  });

  it("moves across columns at the requested position and normalizes both columns", async () => {
    const readyA = await object("Ready A");
    const readyB = await object("Ready B");
    const doingA = await object("Doing A", "doing");
    const doingB = await object("Doing B", "doing");
    await reorderObjects(doingB.id, "ready", [readyA.id, doingB.id, readyB.id]);
    const rows = await getObjects();
    expect(rows.filter((item) => item.status === "ready").map(({ id, position }) => ({ id, position }))).toEqual([
      { id: readyA.id, position: 0 }, { id: doingB.id, position: 1 }, { id: readyB.id, position: 2 },
    ]);
    expect(rows.filter((item) => item.status === "doing").map(({ id, position }) => ({ id, position }))).toEqual([{ id: doingA.id, position: 0 }]);
  });

  it("rejects duplicate or foreign target IDs without partial changes", async () => {
    const first = await object("First");
    const second = await object("Second");
    const before = (await getObjects()).map(({ id, status, position }) => ({ id, status, position }));
    await expect(reorderObjects(first.id, "ready", [first.id, first.id])).rejects.toThrow("Invalid Object ordering");
    await expect(reorderObjects(first.id, "ready", [first.id, "foreign"])).rejects.toThrow("Invalid Object ordering");
    expect((await getObjects()).map(({ id, status, position }) => ({ id, status, position }))).toEqual(before);
    expect(second.position).toBe(1);
  });

  it("requires authentication before the ordering mutation", async () => {
    const first = await object("First");
    mocks.auth.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(reorderObjectsAction({ objectId: first.id, targetStatus: "ready", orderedObjectIds: [first.id] })).rejects.toThrow("Unauthorized");
    expect((await getObjects())[0]).toMatchObject({ id: first.id, position: 0 });
  });

  it("computes before and after insertion for card drop targets", () => {
    const base = [
      { id: "a", status: "ready", position: 0 },
      { id: "b", status: "ready", position: 1 },
      { id: "c", status: "ready", position: 2 },
    ].map((item) => ({ ...item, title: item.id, category: null, archivedAt: null, cancelledAt: null, goal: "", currentState: "", nextAction: "", checklist: [], unresolvedDependencies: 0, recurrence: null, occurrenceNote: null })) as ManagedObject[];
    expect(reorderBoardObjects(base, "a", "ready", "b", true)?.orderedObjectIds).toEqual(["b", "a", "c"]);
    expect(reorderBoardObjects(base, "c", "ready", "b", false)?.orderedObjectIds).toEqual(["a", "c", "b"]);
  });
});
