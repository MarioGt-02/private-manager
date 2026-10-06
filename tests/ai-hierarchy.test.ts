import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { getObjectTables } from "@/lib/db/tables";
import { normalizeDraft } from "@/lib/ai/schemas";
import { prepareReplanProposal } from "@/lib/ai/replan-validation";
import { eq } from "drizzle-orm";
import { POST as analyzeReplan } from "@/app/api/ai/objects/[objectId]/replan/analyze/route";
import { POST as applyReplan } from "@/app/api/ai/objects/[objectId]/replan/apply/route";

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  for (const migration of ["0000_flaky_meggan", "0001_object_archive_metadata", "0002_object_category_presentation", "0003_silent_groot", "0004_keen_diamondback", "0005_boring_quicksilver", "0006_faulty_meteorite", "0007_clever_annihilus","0008_silky_slapstick","0009_loose_skin","0010_optional_checklist_estimated_time"]) {
    await pg.exec(await readFile(`drizzle/${migration}.sql`, "utf8"));
  }
}, 30000);

beforeEach(async () => { await pg.exec("TRUNCATE objects CASCADE"); });
afterAll(async () => { await pg.close(); });

// Explicit opt-in: real provider reasoning; all persistence is disposable PGlite.
it.skipIf(process.env.RUN_REPLAN_TABLE_LIVE !== "1")("live exact Chinese table-only request produces a real table and preserves the Object", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/openai")>("@/lib/ai/openai");
  mocks.openai.mockReturnValue(actual.getOpenAIClient().withOptions({ maxRetries: 0, timeout: 45000 }));
  mocks.auth.mockResolvedValue({});
  const object = await createObject({ title: "恢复旧电脑开机", goal: "让旧电脑恢复稳定开机", currentState: "目前只知道有一台旧电脑需要恢复开机，尚未确认故障原因或已完成的检查。", nextAction: "尝试断电后重新启动", checklist: [
    { title: "进行基础启动检查", completed: false, children: [{ title: "尝试断电后重新启动", completed: false }, { title: "检查显示器连接和外部设备影响", completed: false }] },
    { title: "修复并验证启动", completed: false, children: [{ title: "执行对应修复操作", completed: false }, { title: "确认电脑可以稳定进入系统", completed: false }] },
  ] });
  const before = (await getObject(object.id))!;
  const response = await analyzeReplan(new Request("http://app.test/replan/analyze", { method: "POST", body: JSON.stringify({ message: "新增表格：电脑部件检查表格" }) }), { params: Promise.resolve({ objectId: object.id }) });
  const data = await response.json();
  await mkdir("coverage", { recursive: true });
  await writeFile("coverage/replan-table-live.json", JSON.stringify({ status: response.status, ...data }, null, 2));
  expect(response.status).toBe(200);
  expect(data.proposal.checklistMode).toBe("preserve");
  expect(data.proposal.tablesToAdd[0].title).toBe("电脑部件检查表格");
  expect(data.proposal.tablesToAdd[0].columns.length).toBeGreaterThan(0);
  expect(data.proposal.currentState).toBe(before.currentState);
  expect(data.proposal.removedItemIds).toEqual([]);
  expect(await getObjectTables(object.id)).toHaveLength(0);
  const updated = await applyAIReplan(object.id, data.proposal);
  expect(updated).toEqual(before);
  expect(await getObjectTables(object.id)).toHaveLength(1);
}, 120000);

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
  it("adds a proposed table without changing the existing checklist", async () => {
    const object = await createObject({
      title: "Boot repair",
      currentState: "Initial diagnosis complete",
      nextAction: "Run the startup check",
      checklist: [
        { title: "进行基础启动检查", completed: true },
        { title: "修复并验证启动", completed: false },
      ],
    });
    const before = (await getObject(object.id))!;
    const proposal = {
      title: null,
      goal: null,
      currentState: before.currentState,
      checklistMode: "preserve" as const,
      checklist: before.checklist.filter((item) => item.parentId === null).map((item) => ({ sourceItemId: item.id, title: item.title, completed: item.completed, changeType: "keep" as const, children: [] })),
      removedItemIds: [],
      tablesToAdd: [{
        title: "电脑部件检查表",
        columns: [
          { name: "部件", type: "text" as const, currency: null, carryForward: false },
          { name: "检查内容", type: "text" as const, currency: null, carryForward: false },
          { name: "已检查", type: "checkbox" as const, currency: null, carryForward: false },
          { name: "检查结果", type: "text" as const, currency: null, carryForward: false },
          { name: "备注", type: "text" as const, currency: null, carryForward: false },
        ],
        rows: [{ carryForward: false, cells: ["内存", "检查接触和容量", "false", "", ""] }],
      }],
      summary: "Added a parts inspection table.",
    };

    const updated = await applyAIReplan(object.id, proposal);
    expect(updated.checklist.map((item) => ({ id: item.id, title: item.title, completed: item.completed }))).toEqual(before.checklist.map((item) => ({ id: item.id, title: item.title, completed: item.completed })));
    expect(updated.nextAction).toBe(before.nextAction);
    const tables = await getObjectTables(object.id);
    expect(tables).toHaveLength(1);
    expect(tables![0].title).toBe("电脑部件检查表");
    expect(tables![0].columns.map((column) => column.name)).toEqual(["部件", "检查内容", "已检查", "检查结果", "备注"]);
    expect(tables![0].rows[0].cells[tables![0].columns[0].id]).toBe("内存");
    expect(tables![0].rows[0].cells[tables![0].columns[2].id]).toBe("false");
  });

  it("returns a table-only preview with the original checklist preserved", async () => {
    const object = await createObject({ title: "Hardware check", currentState: "Planning", checklist: [{ title: "Keep this group", completed: true }, { title: "Keep this step", completed: false }] });
    const current = (await getObject(object.id))!;
    const raw = {
      title: null,
      goal: null,
      currentState: current.currentState,
      reasonSummary: "Add a structured parts check without changing the plan.",
      checklistMode: "preserve",
      checklist: [],
      removedItemIds: [],
      tablesToAdd: [{ title: "Parts", columns: [{ name: "Part", type: "text", currency: null, carryForward: false }], rows: [{ carryForward: false, cells: ["RAM"] }] }],
      summary: "Added a parts table.",
    };
    mocks.openai.mockReturnValue({ responses: { create: vi.fn().mockResolvedValue({ output_text: JSON.stringify(raw) }) } });
    mocks.auth.mockResolvedValue({});
    const response = await analyzeReplan(new Request("http://app.test/replan/analyze", { method: "POST", body: JSON.stringify({ message: "添加部件检查表" }) }), { params: Promise.resolve({ objectId: object.id }) });
    expect(response.status).toBe(200);
    const { proposal } = await response.json();
    expect(proposal.checklistMode).toBe("preserve");
    expect(proposal.tablesToAdd[0].title).toBe("Parts");
    expect(proposal.checklist.map((item: { sourceItemId: string }) => item.sourceItemId)).toEqual(current.checklist.filter((item) => item.parentId === null).map((item) => item.id));
  });

  it("repairs the exact Chinese table command instead of treating it as completed work or a checklist step", async () => {
    const object = await createObject({
      title: "恢复旧电脑开机", goal: "恢复电脑稳定启动", currentState: "尚未确认故障原因", nextAction: "尝试断电后重新启动",
      checklist: [{ title: "进行基础启动检查", completed: false, children: [{ title: "尝试断电后重新启动", completed: false }, { title: "检查显示器连接和外部设备影响", completed: false }] }, { title: "修复并验证启动", completed: false }],
    });
    await db.update(schema.checklistItems).set({ estimatedMinutes: 15 }).where(eq(schema.checklistItems.id, object.checklist.find((item) => item.parentId !== null)!.id));
    const before = (await getObject(object.id))!;
    const wrong = {
      title: "AI renamed the Object", goal: "AI changed the goal", currentState: "已有电脑部件检查表格",
      reasonSummary: "加入使用表格的步骤", checklistMode: "replan", removedItemIds: ["invented-removal"], tablesToAdd: [], summary: "已新增表格",
      checklist: [{ sourceItemId: null, title: "使用电脑部件检查表格完成部件检查", completed: true, changeType: "add", children: [] }],
    };
    const table = { title: "电脑部件检查表格", columns: [{ name: "部件", type: "text", currency: null, carryForward: false }, { name: "已检查", type: "checkbox", currency: null, carryForward: false }], rows: [{ carryForward: false, cells: ["内存", "false"] }] };
    const create = vi.fn().mockResolvedValueOnce({ output_text: JSON.stringify(wrong) }).mockResolvedValueOnce({ output_text: JSON.stringify({ ...wrong, tablesToAdd: [table] }) });
    mocks.auth.mockResolvedValue({});
    mocks.openai.mockReturnValue({ responses: { create } });
    const response = await analyzeReplan(new Request("http://app.test/replan/analyze", { method: "POST", body: JSON.stringify({ message: "新增表格：电脑部件检查表格" }) }), { params: Promise.resolve({ objectId: object.id }) });
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(create.mock.calls[1][0].input)).toContain("MISSING_REQUESTED_TABLE");
    const { proposal } = await response.json();
    expect(proposal).toMatchObject({ title: null, goal: null, currentState: before.currentState, checklistMode: "preserve", removedItemIds: [], tablesToAdd: [table] });
    expect(proposal.checklist[0].children.map((item: { sourceItemId: string }) => item.sourceItemId)).toEqual(before.checklist.filter((item) => item.parentId !== null).map((item) => item.id));
    expect(JSON.stringify(proposal.checklist)).not.toContain("使用电脑部件检查表格完成部件检查");
    expect(proposal.summary).not.toContain("已新增表格");
    expect(await getObject(object.id)).toEqual(before);
    expect(await getObjectTables(object.id)).toHaveLength(0);
    const applied = await applyReplan(new Request("http://app.test/replan/apply", { method: "POST", body: JSON.stringify({ proposal }) }), { params: Promise.resolve({ objectId: object.id }) });
    expect(applied.status).toBe(200);
    expect((await applied.json()).object).toEqual(before);
    expect(await getObjectTables(object.id)).toHaveLength(1);
    const retry = await applyReplan(new Request("http://app.test/replan/apply", { method: "POST", body: JSON.stringify({ proposal }) }), { params: Promise.resolve({ objectId: object.id }) });
    expect(retry.status).toBe(200);
    expect((await retry.json()).object).toEqual(before);
    expect(await getObjectTables(object.id)).toHaveLength(1);
    expect((await db.select().from(schema.objectUpdates).where(eq(schema.objectUpdates.id, proposal.proposalId)))).toHaveLength(1);
  });

  it("fails without writes if AI twice omits the actual requested table", async () => {
    const object = await createObject({ title: "Old PC", currentState: "No checks performed", checklist: [{ title: "Startup check", completed: false }] });
    const before = (await getObject(object.id))!;
    const create = vi.fn().mockResolvedValue({ output_text: JSON.stringify({ title: null, goal: null, currentState: "Table exists", reasonSummary: "Use table", checklistMode: "replan", checklist: [{ sourceItemId: null, title: "Use the table", completed: false, changeType: "add", children: [] }], removedItemIds: [], tablesToAdd: [], summary: "Added table" }) });
    mocks.auth.mockResolvedValue({}); mocks.openai.mockReturnValue({ responses: { create } });
    const response = await analyzeReplan(new Request("http://app.test/replan/analyze", { method: "POST", body: JSON.stringify({ message: "新增表格：电脑部件检查表格" }) }), { params: Promise.resolve({ objectId: object.id }) });
    expect(response.status).not.toBe(200);
    expect((await response.json()).error.code).toBe("AI_RESPONSE_INVALID");
    expect(create).toHaveBeenCalledTimes(2);
    expect(await getObject(object.id)).toEqual(before);
    expect(await getObjectTables(object.id)).toHaveLength(0);
  });

  it("preserves all Object fields and an empty checklist even with a hostile preserve payload", async () => {
    const object = await createObject({ title: "Old PC", goal: "Start reliably", currentState: "", nextAction: "Inspect power", checklist: [] });
    const before = (await getObject(object.id))!;
    const table = { title: "Parts", columns: [{ name: "Part", type: "text" as const, currency: null, carryForward: false }], rows: [] };
    const updated = await applyAIReplan(object.id, { title: "Overwrite", goal: "Overwrite", currentState: "Repairs done", checklistMode: "preserve", checklist: [{ sourceItemId: null, title: "New unwanted step", completed: true, changeType: "add", children: [] }], removedItemIds: ["foreign-id"], tablesToAdd: [table], summary: "Proposed table" });
    expect(updated).toEqual(before);
    await expect(applyAIReplan(object.id, { title: null, goal: null, currentState: "", checklistMode: "preserve", checklist: [], removedItemIds: [], tablesToAdd: [], summary: "Empty proposal" })).rejects.toThrow("contains no tables");
    expect(await getObjectTables(object.id)).toHaveLength(1);
  });

  it("supports successful mixed checklist and table changes without forcing preserve mode", async () => {
    const object = await createObject({ title: "Old PC", currentState: "No checks", checklist: [{ title: "Check power", completed: false }] });
    const raw = { title: null, goal: null, currentState: "Power checked", reasonSummary: "Add repair and records", checklistMode: "replan", checklist: [{ sourceItemId: object.checklist[0].id, title: "Check power", completed: true, changeType: "keep", children: [] }, { sourceItemId: null, title: "Test memory", completed: false, changeType: "add", children: [] }], removedItemIds: [], tablesToAdd: [{ title: "Parts", columns: [{ name: "Part", type: "text", currency: null, carryForward: false }], rows: [] }], summary: "Updated repair plan" };
    mocks.auth.mockResolvedValue({}); mocks.openai.mockReturnValue({ responses: { create: vi.fn().mockResolvedValue({ output_text: JSON.stringify(raw) }) } });
    const response = await analyzeReplan(new Request("http://app.test/replan/analyze", { method: "POST", body: JSON.stringify({ message: "新增表格：Parts，并添加内存检查步骤" }) }), { params: Promise.resolve({ objectId: object.id }) });
    expect(response.status).toBe(200);
    const { proposal } = await response.json();
    expect(proposal.checklistMode).toBe("replan");
    const updated = await applyAIReplan(object.id, proposal);
    expect(updated.currentState).toBe("Power checked");
    expect(updated.nextAction).toBe("Test memory");
    expect(updated.checklist).toHaveLength(2);
    expect(await getObjectTables(object.id)).toHaveLength(1);
  });

  it("rejects invalid table cells and row widths even for direct transactional callers", async () => {
    const object = await createObject({ title: "Old PC", checklist: [] });
    const base = { title: null, goal: null, currentState: "", checklistMode: "preserve" as const, checklist: [], removedItemIds: [], summary: "No changes" };
    for (const cells of [["not a number"], [], ["1", "extra"]]) {
      await expect(applyAIReplan(object.id, { ...base, tablesToAdd: [{ title: "Parts", columns: [{ name: "Count", type: "number", currency: null, carryForward: false }], rows: [{ carryForward: false, cells }] }] })).rejects.toThrow("INVALID_CELL_VALUE");
      expect(await getObjectTables(object.id)).toHaveLength(0);
    }
  });

  it("appends tables after the highest position rather than the count", async () => {
    const object = await createObject({ title: "Old PC", checklist: [] });
    await db.insert(schema.objectTables).values({ id: "old-table", objectId: object.id, title: "Existing", position: 8 });
    await applyAIReplan(object.id, { title: null, goal: null, currentState: "", checklistMode: "preserve", checklist: [], removedItemIds: [], tablesToAdd: [{ title: "New", columns: [{ name: "Part", type: "text", currency: null, carryForward: false }], rows: [] }], summary: "Added new table" });
    expect((await getObjectTables(object.id))!.map((table) => table.position)).toEqual([8, 9]);
  });

  it("rolls back the checklist and table when a mixed proposal exceeds the table limit", async () => {
    const object = await createObject({ title: "O", currentState: "c", checklist: [{ title: "Existing", completed: false }] });
    const before = (await getObject(object.id))!;
    const tables = Array.from({ length: 6 }, (_, index) => ({
      title: `Table ${index}`,
      columns: [{ name: "Item", type: "text" as const, currency: null, carryForward: false }],
      rows: [],
    }));
    await expect(applyAIReplan(object.id, {
      title: null,
      goal: null,
      currentState: "changed",
      checklistMode: "replan",
      checklist: [{ sourceItemId: before.checklist[0].id, title: "Renamed", completed: false, changeType: "modify", children: [] }],
      removedItemIds: [],
      tablesToAdd: tables,
      summary: "Should roll back.",
    })).rejects.toThrow("TABLES_LIMIT_REACHED");
    expect(await getObject(object.id)).toEqual(before);
    expect(await getObjectTables(object.id)).toEqual([]);
  });

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
    const raw = { title: null, goal: null, currentState: "New facts", reasonSummary: "Plan", summary: "Plan", removedItemIds: [], checklist: [{ sourceItemId: "invented-id", title: "Not an existing item", completed: false, changeType: "keep", children: [] }] };
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

  it("repairs a duplicate checklist ID once and returns the corrected preview", async () => {
    const object = await createObject({ title: "O", checklist: [{ title: "Existing", completed: false }] });
    const existing = (await getObject(object.id))!.checklist[0];
    const duplicate = { title: null, goal: null, currentState: "New facts", reasonSummary: "Plan", summary: "Plan", removedItemIds: [], checklist: [
      { sourceItemId: existing.id, title: existing.title, completed: false, changeType: "keep", children: [] },
      { sourceItemId: existing.id, title: existing.title, completed: false, changeType: "keep", children: [] },
    ] };
    const corrected = { ...duplicate, checklist: [{ ...duplicate.checklist[0] }] };
    mocks.auth.mockResolvedValue({});
    const create = vi.fn()
      .mockResolvedValueOnce({ output_text: JSON.stringify(duplicate) })
      .mockResolvedValueOnce({ output_text: JSON.stringify(corrected) });
    mocks.openai.mockReturnValue({ responses: { create } });
    const response = await analyzeReplan(new Request("http://app.test/replan/analyze", { method: "POST", body: JSON.stringify({ message: "改成 Life Assistant 核心框架" }) }), { params: Promise.resolve({ objectId: object.id }) });
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(2);
    expect((await response.json()).proposal.checklist).toHaveLength(1);
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
