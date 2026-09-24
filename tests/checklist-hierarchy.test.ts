import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";
import { COMPLETION_NEXT_ACTION, deriveNextAction, sortChecklist, withDerivedCompletion } from "@/lib/objects/next-action";
import type { ChecklistItem } from "@/lib/types/object";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mocks = vi.hoisted(() => ({ auth: vi.fn(), openai: vi.fn() }));
vi.mock("@/lib/db/index", () => ({ getDb: () => db }));
vi.mock("@/lib/auth/require-auth", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: mocks.openai }));

import { createChecklistItem, createObject, deleteChecklistItem, getObject, reorderChecklistItems, updateChecklistItem } from "@/lib/db/queries";

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  for (const migration of ["0000_flaky_meggan", "0001_object_archive_metadata", "0002_object_category_presentation", "0003_silent_groot", "0004_keen_diamondback", "0005_boring_quicksilver", "0006_faulty_meteorite", "0007_clever_annihilus","0008_silky_slapstick","0009_loose_skin"]) {
    await pg.exec(await readFile(`drizzle/${migration}.sql`, "utf8"));
  }
}, 30000);

beforeEach(async () => { await pg.exec("TRUNCATE objects CASCADE"); });
afterAll(async () => { await pg.close(); });

describe("deriveNextAction (hierarchy)", () => {
  it("picks the first unfinished leaf over a parent container", () => {
    const items = [
      { id: "p", parentId: null, title: "Parent", completed: false, position: 0 },
      { id: "c1", parentId: "p", title: "Child 1", completed: true, position: 0 },
      { id: "c2", parentId: "p", title: "Child 2", completed: false, position: 1 },
    ];
    expect(deriveNextAction(items)).toBe("Child 2");
  });

  it("falls back when all leaves are complete", () => {
    const items = [
      { id: "p", parentId: null, title: "Parent", completed: true, position: 0 },
      { id: "c1", parentId: "p", title: "Child 1", completed: true, position: 0 },
    ];
    expect(deriveNextAction(items)).toBe(COMPLETION_NEXT_ACTION);
  });

  it("treats a parent with zero children as a normal leaf", () => {
    expect(deriveNextAction([{ id: "p", parentId: null, title: "Leaf", completed: false, position: 0 }])).toBe("Leaf");
  });
});

describe("withDerivedCompletion", () => {
  it("marks a parent complete only when all children are complete", () => {
    const items: ChecklistItem[] = [
      { id: "p", parentId: null, title: "P", completed: false, position: 0 },
      { id: "c1", parentId: "p", title: "C1", completed: true, position: 0 },
      { id: "c2", parentId: "p", title: "C2", completed: false, position: 1 },
    ];
    expect(withDerivedCompletion(items).find((i) => i.id === "p")!.completed).toBe(false);
    const allDone = withDerivedCompletion(items.map((i) => (i.id === "c2" ? { ...i, completed: true } : i)));
    expect(allDone.find((i) => i.id === "p")!.completed).toBe(true);
  });
});

describe("sortChecklist", () => {
  it("orders each parent immediately followed by its children", () => {
    const items: ChecklistItem[] = [
      { id: "c2", parentId: "p2", title: "P2 child", completed: false, position: 0 },
      { id: "p1", parentId: null, title: "P1", completed: false, position: 0 },
      { id: "p2", parentId: null, title: "P2", completed: false, position: 1 },
      { id: "c1", parentId: "p1", title: "P1 child", completed: false, position: 0 },
    ];
    expect(sortChecklist(items).map((i) => i.id)).toEqual(["p1", "c1", "p2", "c2"]);
  });
});

describe("hierarchical checklist persistence", () => {
  it("rejects a second nesting level (grandchild)", async () => {
    const object = await createObject({ title: "Desk" });
    const parent = await createChecklistItem(object.id, "Cut wood");
    const child = await createChecklistItem(object.id, "Cut legs", parent.id);
    await expect(createChecklistItem(object.id, "Grandchild", child.id)).rejects.toThrow("Only one level");
  });

  it("rejects a cross-object parent reference", async () => {
    const a = await createObject({ title: "A" });
    const b = await createObject({ title: "B" });
    const parentInB = await createChecklistItem(b.id, "B parent");
    await expect(createChecklistItem(a.id, "orphan", parentInB.id)).rejects.toThrow("Parent checklist item not found.");
  });

  it("derives parent completion from children and rejects direct parent toggle", async () => {
    const object = await createObject({ title: "Desk" });
    const parent = await createChecklistItem(object.id, "Sand");
    const child1 = await createChecklistItem(object.id, "Sand top", parent.id);
    const child2 = await createChecklistItem(object.id, "Sand legs", parent.id);

    await expect(updateChecklistItem(parent.id, true)).rejects.toThrow("derived");

    await updateChecklistItem(child1.id, true);
    await updateChecklistItem(child2.id, true);
    expect((await getObject(object.id))!.checklist.find((i) => i.id === parent.id)!.completed).toBe(true);

    await updateChecklistItem(child2.id, false);
    expect((await getObject(object.id))!.checklist.find((i) => i.id === parent.id)!.completed).toBe(false);
  });

  it("derives next action from the first unfinished leaf", async () => {
    const object = await createObject({ title: "Desk" });
    const parent = await createChecklistItem(object.id, "Sand");
    await createChecklistItem(object.id, "Sand legs", parent.id);
    expect((await getObject(object.id))!.nextAction).toBe("Sand legs");
  });

  it("cascade-deletes children when a parent is deleted", async () => {
    const object = await createObject({ title: "Desk" });
    const parent = await createChecklistItem(object.id, "Sand");
    await createChecklistItem(object.id, "Sand top", parent.id);
    await deleteChecklistItem(parent.id, object.id);
    expect((await getObject(object.id))!.checklist).toHaveLength(0);
  });

  it("normalizes sibling positions after a delete", async () => {
    const object = await createObject({ title: "Desk" });
    const a = await createChecklistItem(object.id, "A");
    const b = await createChecklistItem(object.id, "B");
    const c = await createChecklistItem(object.id, "C");
    await deleteChecklistItem(b.id, object.id);
    const top = (await getObject(object.id))!.checklist.filter((i) => i.parentId == null);
    expect(top.map((i) => [i.id, i.position])).toEqual([[a.id, 0], [c.id, 1]]);
  });

  it("reorders only within a sibling group", async () => {
    const object = await createObject({ title: "Desk" });
    const parent = await createChecklistItem(object.id, "Sand");
    const c1 = await createChecklistItem(object.id, "Sand top", parent.id);
    const c2 = await createChecklistItem(object.id, "Sand legs", parent.id);
    await reorderChecklistItems(object.id, parent.id, [c2.id, c1.id]);
    const children = (await getObject(object.id))!.checklist.filter((i) => i.parentId === parent.id);
    expect(children.map((i) => [i.id, i.position])).toEqual([[c2.id, 0], [c1.id, 1]]);
  });
});
