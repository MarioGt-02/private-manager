import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mocks = vi.hoisted(() => ({ auth: vi.fn(), ai: vi.fn(), response: vi.fn() }));
vi.mock("@/lib/db/index", () => ({ getDb: () => db }));
vi.mock("@/lib/auth/require-auth", () => ({ requireAuth: mocks.auth, UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: mocks.ai }));

import { POST as chat } from "@/app/api/ai/create-object/chat/route";
import { POST as finalize } from "@/app/api/ai/create-object/finalize/route";
import { createStructuredObject } from "@/lib/db/structured-create";
import { getObjectTables } from "@/lib/db/tables";
import { draftRecurrenceSchema, finalizeRecurrenceSchema, finalizeTableSchema } from "@/lib/ai/schemas";

const request = (body: unknown) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  for (const file of ["0000_flaky_meggan", "0001_object_archive_metadata", "0002_object_category_presentation", "0003_silent_groot", "0004_keen_diamondback", "0005_boring_quicksilver", "0006_faulty_meteorite", "0007_clever_annihilus", "0008_silky_slapstick", "0009_loose_skin"]) {
    await pg.exec(await readFile(`drizzle/${file}.sql`, "utf8"));
  }
}, 30000);

beforeEach(async () => {
  await pg.exec("TRUNCATE objects CASCADE");
  await pg.exec("TRUNCATE categories CASCADE");
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-not-a-real-key");
  mocks.auth.mockResolvedValue({});
  mocks.ai.mockReturnValue({ responses: { create: mocks.response } });
});
afterAll(async () => { vi.unstubAllEnvs(); await pg.close(); });

const baseDraft = {
  title: "Audi A3 Annual Maintenance",
  goal: "Keep the car serviced",
  currentState: "Planning",
  nextAction: "Record mileage",
  checklist: [{ title: "Record mileage", completed: false, children: [] }],
  categoryId: null as string | null,
  recurrence: null,
  table: null,
};

const maintenanceTable = {
  title: "Maintenance",
  columns: [
    { name: "Maintenance Item", type: "text" as const, currency: null, carryForward: true },
    { name: "Serviced", type: "checkbox" as const, currency: null, carryForward: false },
    { name: "Cost", type: "currency" as const, currency: "EUR", carryForward: false },
  ],
  rows: [
    { carryForward: true, cells: ["Engine oil", "false", "55"] },
    { carryForward: false, cells: ["One-off fix", "true", ""] },
  ],
};

const scheduledRecurrence = { frequency: "yearly" as const, interval: 1, basis: "scheduled_date" as const, nextDate: "2027-03-31" };

async function seedCategory(name = "Vehicles") {
  const id = "c0000000-0000-4000-8000-000000000001";
  await db.insert(schema.categories).values({ id, name, color: "amber" });
  return id;
}

describe("Structured draft persistence", () => {
  it("still creates a plain Object without recurrence or table", async () => {
    const response = await finalize(request({ draft: { ...baseDraft } }));
    expect(response.status).toBe(200);
    const { object } = await response.json();
    expect(object.title).toBe(baseDraft.title);
    expect(object.recurrence).toBeNull();
    expect(await getObjectTables(object.id)).toEqual([]);
  });

  it("persists a scheduled recurrence", async () => {
    const response = await finalize(request({ draft: { ...baseDraft, recurrence: scheduledRecurrence } }));
    expect(response.status).toBe(200);
    const { object } = await response.json();
    expect(object.recurrence).toMatchObject({ frequency: "yearly", interval: 1, basis: "scheduled_date", nextDate: "2027-03-31" });
  });

  it("persists a completion-based recurrence without a date", async () => {
    const response = await finalize(request({ draft: { ...baseDraft, recurrence: { frequency: "monthly", interval: 2, basis: "completion_date", nextDate: null } } }));
    expect(response.status).toBe(200);
    const { object } = await response.json();
    expect(object.recurrence?.basis).toBe("completion_date");
    expect(object.recurrence?.nextDate).toBeNull();
  });

  it("persists a table with columns, rows, cells, carry-forward and currency in order", async () => {
    const response = await finalize(request({ draft: { ...baseDraft, table: maintenanceTable } }));
    expect(response.status).toBe(200);
    const { object } = await response.json();

    const tables = (await getObjectTables(object.id))!;
    expect(tables).toHaveLength(1);
    const table = tables[0];
    expect(table.title).toBe("Maintenance");
    expect(table.columns.map((column) => column.name)).toEqual(["Maintenance Item", "Serviced", "Cost"]);
    expect(table.columns.map((column) => column.type)).toEqual(["text", "checkbox", "currency"]);
    expect(table.columns[0].carryForward).toBe(true);
    expect(table.columns[2].currency).toBe("EUR");

    const columnId = (name: string) => table.columns.find((column) => column.name === name)!.id;
    expect(table.rows).toHaveLength(2);
    expect(table.rows.map((row) => row.carryForward)).toEqual([true, false]);
    expect(table.rows[0].cells).toEqual({ [columnId("Maintenance Item")]: "Engine oil", [columnId("Serviced")]: "false", [columnId("Cost")]: "55.00" });
    expect(table.rows[1].cells[columnId("Serviced")]).toBe("true");
    // An empty cell follows the existing "no cell row" semantics.
    expect(table.rows[1].cells[columnId("Cost")]).toBeUndefined();
  });

  it("persists recurrence and table together", async () => {
    const response = await finalize(request({ draft: { ...baseDraft, recurrence: scheduledRecurrence, table: maintenanceTable } }));
    expect(response.status).toBe(200);
    const { object } = await response.json();
    expect(object.recurrence?.frequency).toBe("yearly");
    expect((await getObjectTables(object.id))!).toHaveLength(1);
  });

  it("keeps the deterministic Next Action derived from the checklist", async () => {
    const draft = { ...baseDraft, checklist: [{ title: "Record mileage", completed: true, children: [] }, { title: "Buy oil", completed: false, children: [] }], nextAction: "AI text is overridden" };
    const response = await finalize(request({ draft }));
    const { object } = await response.json();
    expect(object.nextAction).toBe("Buy oil");
  });

  it("assigns a valid category and rejects an unknown one", async () => {
    const categoryId = await seedCategory("Vehicles");
    const ok = await finalize(request({ draft: { ...baseDraft, categoryId } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).object.categoryId).toBe(categoryId);

    const bogus = await finalize(request({ draft: { ...baseDraft, categoryId: "00000000-0000-4000-8000-0000000000ff" } }));
    expect(bogus.status).toBe(400);
  });
});

describe("Chat structured draft pass-through", () => {
  const chatOutput = (draft: unknown, phase = "proposal") =>
    mocks.response.mockResolvedValue({ output_text: JSON.stringify({ message: "Here is the proposal.", phase, draft }) });

  it("returns a partial recurrence and table while clarifying, without discarding them", async () => {
    chatOutput({
      title: "Audi A3 Annual Maintenance", goal: "Keep the car serviced", currentState: "Planning", nextAction: "Record mileage",
      suggestedCategoryName: null,
      checklist: [{ title: "Record mileage", completed: false, children: [] }],
      recurrence: { frequency: "yearly", interval: 1 },
      table: { title: "Maintenance", columns: [{ name: "Maintenance Item", type: "text", currency: null, carryForward: true }], rows: [{ carryForward: true, cells: ["Engine oil"] }] },
    }, "clarifying");

    const response = await chat(request({ messages: [{ role: "user", content: "Service my Audi every year" }] }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.phase).toBe("clarifying");
    expect(data.draft.recurrence).toEqual({ frequency: "yearly", interval: 1 });
    expect(data.draft.table.title).toBe("Maintenance");
    expect(data.draft.table.rows[0].cells).toEqual(["Engine oil"]);
    expect(data.draft.table.columns[0].carryForward).toBe(true);
  });

  it("passes the edited recurrence and table back into the model context", async () => {
    chatOutput({ title: "X", goal: "g", currentState: "c", nextAction: "n", suggestedCategoryName: null, checklist: [{ title: "step", completed: false, children: [] }] });
    await chat(request({
      messages: [{ role: "user", content: "adjust it" }],
      currentDraft: { ...baseDraft, recurrence: { frequency: "monthly", interval: 2 }, table: maintenanceTable },
    }));
    const sent = mocks.response.mock.calls[0][0] as { input: unknown };
    const inputString = JSON.stringify(sent.input);
    expect(inputString).toContain("recurrence");
    expect(inputString).toContain("monthly");
    expect(inputString).toContain("Maintenance");
    expect(inputString).toContain("carryForward");
  });
});

describe("Structured draft atomicity", () => {
  it("rolls back the whole creation when table persistence fails", async () => {
    const badTable = {
      title: "Broken",
      columns: [{ name: "Cost", type: "number" as const, currency: null, carryForward: false }],
      rows: [{ carryForward: false, cells: ["not a number"] }],
    };
    await expect(createStructuredObject({
      ...baseDraft,
      checklist: baseDraft.checklist,
      recurrence: null,
      table: badTable,
    })).rejects.toBeTruthy();

    expect(await db.select().from(schema.objects)).toHaveLength(0);
    expect(await db.select().from(schema.objectTables)).toHaveLength(0);
    expect(await db.select().from(schema.checklistItems)).toHaveLength(0);
    expect(await db.select().from(schema.objectUpdates)).toHaveLength(0);
  });

  it("performs no partial write for an invalid structured draft", async () => {
    const response = await finalize(request({ draft: { ...baseDraft, table: { title: "T", columns: [{ name: "X", type: "number", currency: null, carryForward: false }], rows: [{ carryForward: false, cells: ["abc"] }] } } }));
    expect(response.status).toBe(400);
    expect(await db.select().from(schema.objects)).toHaveLength(0);
  });
});

describe("Structured draft schemas", () => {
  it("accepts a partial recurrence in the draft layer", () => {
    expect(draftRecurrenceSchema.safeParse({ frequency: "yearly", interval: 1 }).success).toBe(true);
    expect(draftRecurrenceSchema.safeParse({}).success).toBe(true);
  });

  it("requires a scheduled date only for scheduled-date recurrence at finalize", () => {
    expect(finalizeRecurrenceSchema.safeParse({ frequency: "yearly", interval: 1, basis: "scheduled_date", nextDate: null }).success).toBe(false);
    expect(finalizeRecurrenceSchema.safeParse({ frequency: "yearly", interval: 1, basis: "scheduled_date", nextDate: "2027-03-31" }).success).toBe(true);
    expect(finalizeRecurrenceSchema.safeParse({ frequency: "yearly", interval: 1, basis: "completion_date", nextDate: null }).success).toBe(true);
  });

  it("rejects a fabricated or invalid scheduled date", () => {
    expect(finalizeRecurrenceSchema.safeParse({ frequency: "yearly", interval: 1, basis: "scheduled_date", nextDate: "2026-02-30" }).success).toBe(false);
  });

  it("rejects unknown column types and misaligned cells", () => {
    expect(finalizeTableSchema.safeParse({ title: "T", columns: [{ name: "X", type: "formula", currency: null, carryForward: false }], rows: [] }).success).toBe(false);
    expect(finalizeTableSchema.safeParse({ title: "T", columns: [{ name: "X", type: "number", currency: null, carryForward: false }], rows: [{ carryForward: false, cells: ["not a number"] }] }).success).toBe(false);
    expect(finalizeTableSchema.safeParse({ title: "T", columns: [{ name: "X", type: "text", currency: null, carryForward: false }], rows: [{ carryForward: false, cells: [] }] }).success).toBe(false);
  });

  it("rejects invalid date/currency/checkbox cell values but accepts a real checkbox", () => {
    const col = { name: "X", carryForward: false, currency: null as string | null };
    expect(finalizeTableSchema.safeParse({ title: "T", columns: [{ ...col, type: "date" }], rows: [{ carryForward: false, cells: ["2026-02-30"] }] }).success).toBe(false);
    expect(finalizeTableSchema.safeParse({ title: "T", columns: [{ ...col, type: "currency", currency: "EUR" }], rows: [{ carryForward: false, cells: ["€185"] }] }).success).toBe(false);
    expect(finalizeTableSchema.safeParse({ title: "T", columns: [{ ...col, type: "checkbox" }], rows: [{ carryForward: false, cells: ["yes"] }] }).success).toBe(false);
    expect(finalizeTableSchema.safeParse({ title: "T", columns: [{ ...col, type: "checkbox" }], rows: [{ carryForward: false, cells: ["true"] }] }).success).toBe(true);
  });
});
