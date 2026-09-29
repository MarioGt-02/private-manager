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
import { prepareReplanProposal } from "@/lib/ai/replan-validation";
import { POST as analyzeReplan } from "@/app/api/ai/objects/[objectId]/replan/analyze/route";
import { POST as applyReplan } from "@/app/api/ai/objects/[objectId]/replan/apply/route";

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
  it("preserves existing checklist items omitted by an otherwise valid AI proposal", async () => {
    const object = await createObject({ title: "O", goal: "g", currentState: "c", nextAction: "n", checklist: [
      { title: "Keep this", completed: true },
      { title: "Also keep this", completed: false },
    ] });
    const current = (await getObject(object.id))!;
    const first = current.checklist.find((item) => item.title === "Keep this")!;
    const prepared = prepareReplanProposal({
      title: null,
      goal: null,
      currentState: "replanned",
      checklist: [{ sourceItemId: first.id, title: first.title, completed: first.completed, changeType: "keep", children: [] }],
      removedItemIds: [],
      summary: "Changed the current state only.",
    }, current.checklist);
    expect(prepared.checklist.map((item) => item.title)).toEqual(["Keep this", "Also keep this"]);
    const updated = await applyAIReplan(object.id, prepared);
    expect(updated.checklist.map((item) => item.title)).toEqual(["Keep this", "Also keep this"]);
  });

  it("prepares omissions before preview and applies the exact displayed plan without user edits", async () => {
    const object = await createObject({ title: "O", checklist: [{ title: "Parent", completed: false, children: [{ title: "Child", completed: true }] }, { title: "Other", completed: false }] });
    const parent = object.checklist.find((item) => item.parentId === null)!;
    const raw = { title: null, goal: null, currentState: "New facts", reasonSummary: "Keep the work", summary: "Updated plan", removedItemIds: [], checklist: [{ sourceItemId: parent.id, title: parent.title, completed: true, changeType: "keep", children: [] }] };
    mocks.openai.mockReturnValue({ responses: { create: vi.fn().mockResolvedValue({ output_text: JSON.stringify(raw) }) } });
    mocks.auth.mockResolvedValue({});
    const params = { params: Promise.resolve({ objectId: object.id }) };
    const response = await analyzeReplan(new Request("http://app.test/replan/analyze", { method: "POST", body: JSON.stringify({ message: "Update the plan" }) }), params);
    expect(response.status).toBe(200);
    const { proposal } = await response.json();
    expect(proposal.checklist).toHaveLength(2);
    expect(proposal.checklist[0].children[0].title).toBe("Child");
    expect(raw.checklist[0].children).toEqual([]);
    const applied = await applyReplan(new Request("http://app.test/replan/apply", { method: "POST", body: JSON.stringify({ proposal }) }), params);
    expect(applied.status).toBe(200);
    expect((await applied.json()).object.checklist.map((item: { title: string }) => item.title)).toEqual(["Parent", "Child", "Other"]);
  });

  it("rejects an incomplete plan without falsely saying the user edited the Object or partially writing", async () => {
    const object = await createObject({ title: "O", checklist: [{ title: "Existing", completed: true }] });
    const before = await getObject(object.id);
    mocks.auth.mockResolvedValue({});
    const response = await applyReplan(new Request("http://app.test/replan/apply", { method: "POST", body: JSON.stringify({ proposal: { title: null, goal: null, currentState: "Should not save", reasonSummary: "Plan", summary: "Plan", removedItemIds: [], checklist: [{ sourceItemId: null, title: "New", completed: false, changeType: "add", children: [] }] } }) }), { params: Promise.resolve({ objectId: object.id }) });
    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error.message).toContain("incomplete AI proposal");
    expect(error.message).not.toContain("The Object changed");
    expect(await getObject(object.id)).toEqual(before);
  });

  it("rejects invented AI IDs during analyze instead of returning an unusable preview", async () => {
    const object = await createObject({ title: "O", checklist: [{ title: "Existing", completed: false }] });
    const before = await getObject(object.id);
    const raw = { title: null, goal: null, currentState: "New facts", reasonSummary: "Plan", summary: "Plan", removedItemIds: [], checklist: [{ sourceItemId: "invented-id", title: "Existing", completed: false, changeType: "keep", children: [] }] };
    mocks.auth.mockResolvedValue({});
    mocks.openai.mockReturnValue({ responses: { create: vi.fn().mockResolvedValue({ output_text: JSON.stringify(raw) }) } });
    const response = await analyzeReplan(new Request("http://app.test/replan/analyze", { method: "POST", body: JSON.stringify({ message: "Update the plan" }) }), { params: Promise.resolve({ objectId: object.id }) });
    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error.code).toBe("AI_RESPONSE_INVALID");
    expect(data.error.message).toContain("IDs that do not exist");
    expect(data.proposal).toBeUndefined();
    expect(await getObject(object.id)).toEqual(before);
  });

  it("allows converting an old parent into a child when its old children are explicitly removed", async () => {
    const object = await createObject({ title: "O", checklist: [{ title: "Old parent", completed: false, children: [{ title: "Old child", completed: false }] }] });
    const parent = object.checklist.find((item) => item.parentId === null)!;
    const child = object.checklist.find((item) => item.parentId !== null)!;
    const updated = await applyAIReplan(object.id, { title: null, goal: null, currentState: "New structure", summary: "New plan", removedItemIds: [child.id], checklist: [{ sourceItemId: null, title: "New group", completed: false, changeType: "add", children: [{ sourceItemId: parent.id, title: parent.title, completed: false, changeType: "modify" }] }] });
    expect(updated.checklist).toHaveLength(2);
    expect(updated.checklist.find((item) => item.id === parent.id)?.parentId).not.toBeNull();
    expect(updated.checklist.some((item) => item.id === child.id)).toBe(false);
  });

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
