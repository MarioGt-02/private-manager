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

import { applyAIProgressUpdate, applyAIReplan, createObject, getObject } from "@/lib/db/queries";
import { normalizeDraft } from "@/lib/ai/schemas";

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  for (const migration of ["0000_flaky_meggan", "0001_object_archive_metadata", "0002_object_category_presentation", "0003_silent_groot", "0004_keen_diamondback", "0005_boring_quicksilver", "0006_faulty_meteorite", "0007_clever_annihilus","0008_silky_slapstick","0009_loose_skin"]) {
    await pg.exec(await readFile(`drizzle/${migration}.sql`, "utf8"));
  }
}, 30000);

beforeEach(async () => { await pg.exec("TRUNCATE objects CASCADE"); });
afterAll(async () => { await pg.close(); });

describe("AI Create hierarchy", () => {
  it("persists a nested checklist, derives parent completion, and points Next Action at the first child leaf", async () => {
    const object = await createObject({
      title: "Backup", goal: "Reliable backups", currentState: "Planning", nextAction: "Plan",
      checklist: [
        { title: "Prepare backup", completed: false, children: [{ title: "Create pg_dump", completed: false }, { title: "Test restore", completed: false }] },
        { title: "Document", completed: false, children: [] },
      ],
    });
    const loaded = (await getObject(object.id))!;
    const parent = loaded.checklist.find((i) => i.title === "Prepare backup")!;
    expect(parent.parentId).toBeNull();
    expect(parent.completed).toBe(false);
    expect(loaded.checklist.filter((i) => i.parentId === parent.id).map((i) => i.title)).toEqual(["Create pg_dump", "Test restore"]);
    expect(loaded.nextAction).toBe("Create pg_dump");
  });

  it("keeps flat checklists compatible", async () => {
    const object = await createObject({ title: "Clean car", goal: "g", currentState: "c", nextAction: "n", checklist: [{ title: "Vacuum", completed: false, children: [] }] });
    const loaded = (await getObject(object.id))!;
    expect(loaded.checklist).toHaveLength(1);
    expect(loaded.checklist[0].parentId).toBeNull();
  });

  it("normalizeDraft keeps one level and drops empty children", () => {
    const normalized = normalizeDraft({
      title: "t", goal: "g", currentState: "c", nextAction: "n",
      checklist: [{ title: "Parent", completed: false, children: [{ title: "  Child  ", completed: false }, { title: "   ", completed: false }] }],
    });
    expect(normalized!.checklist[0].children).toEqual([{ title: "Child", completed: false }]);
  });
});

describe("AI Progress hierarchy", () => {
  it("adds a child under an existing parent and rejects an invalid parent", async () => {
    const object = await createObject({ title: "O", goal: "g", currentState: "c", nextAction: "n", checklist: [{ title: "Parent", completed: false, children: [] }] });
    const parent = (await getObject(object.id))!.checklist[0];
    const updated = await applyAIProgressUpdate(object.id, { currentState: "c2", nextAction: "n", completedItemIds: [], reopenedItemIds: [], newChecklistItems: [{ title: "Child", parentItemId: parent.id }], summary: "s" });
    expect(updated.checklist.filter((i) => i.parentId === parent.id).map((i) => i.title)).toEqual(["Child"]);
    await expect(applyAIProgressUpdate(object.id, { currentState: "c", nextAction: "n", completedItemIds: [], reopenedItemIds: [], newChecklistItems: [{ title: "X", parentItemId: "nope" }], summary: "s" })).rejects.toThrow("UPDATE_CONFLICT");
  });

  it("ignores parent IDs in completedItemIds (derived completion only)", async () => {
    const object = await createObject({ title: "O", goal: "g", currentState: "c", nextAction: "n", checklist: [{ title: "Parent", completed: false, children: [{ title: "Child", completed: false }] }] });
    const parent = (await getObject(object.id))!.checklist.find((i) => i.title === "Parent")!;
    const child = (await getObject(object.id))!.checklist.find((i) => i.title === "Child")!;
    const updated = await applyAIProgressUpdate(object.id, { currentState: "c", nextAction: "n", completedItemIds: [parent.id, child.id], reopenedItemIds: [], newChecklistItems: [], summary: "s" });
    expect(updated.checklist.find((i) => i.id === child.id)!.completed).toBe(true);
    expect(updated.checklist.find((i) => i.id === parent.id)!.completed).toBe(true);
  });
});

describe("AI Replan hierarchy", () => {
  it("adds a parent with children and removes a parent (cascading its child)", async () => {
    const object = await createObject({ title: "O", goal: "g", currentState: "c", nextAction: "n", checklist: [{ title: "Old parent", completed: false, children: [{ title: "Old child", completed: false }] }] });
    const oldParent = (await getObject(object.id))!.checklist.find((i) => i.title === "Old parent")!;
    const updated = await applyAIReplan(object.id, {
      title: null, goal: null, currentState: "c2",
      checklist: [{ sourceItemId: null, title: "New parent", completed: false, changeType: "add", children: [{ sourceItemId: null, title: "New child", completed: false, changeType: "add" }] }],
      removedItemIds: [oldParent.id],
      summary: "s",
    });
    expect(updated.checklist.map((i) => i.title)).toEqual(["New parent", "New child"]);
    expect(updated.nextAction).toBe("New child");
  });

  it("modifies a child preserving its id and derives parent completion", async () => {
    const object = await createObject({ title: "O", goal: "g", currentState: "c", nextAction: "n", checklist: [{ title: "Parent", completed: false, children: [{ title: "Child", completed: false }] }] });
    const child = (await getObject(object.id))!.checklist.find((i) => i.title === "Child")!;
    const parent = (await getObject(object.id))!.checklist.find((i) => i.title === "Parent")!;
    const updated = await applyAIReplan(object.id, {
      title: null, goal: null, currentState: "c",
      checklist: [{ sourceItemId: parent.id, title: "Parent", completed: false, changeType: "keep", children: [{ sourceItemId: child.id, title: "Renamed child", completed: true, changeType: "modify" }] }],
      removedItemIds: [],
      summary: "s",
    });
    const renamed = updated.checklist.find((i) => i.id === child.id)!;
    expect(renamed.title).toBe("Renamed child");
    expect(renamed.completed).toBe(true);
    expect(updated.checklist.find((i) => i.id === parent.id)!.completed).toBe(true);
  });
});
