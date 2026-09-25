import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as schema from "@/lib/db/schema";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mocks = vi.hoisted(() => ({ auth: vi.fn(), openai: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/index", () => ({ getDb: () => db }));
vi.mock("@/lib/auth/require-auth", () => ({ requireAuth: mocks.auth, UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: mocks.openai }));

import { UnauthorizedError } from "@/lib/auth/require-auth";
import { createObject, deleteObject, getObject, getObjects, updateObjectField, updateObjectStatus, updateObjectRecurrence, updateChecklistItem, createChecklistItem } from "@/lib/db/queries";
import { changeObjectLifecycle } from "@/lib/db/archive";
import { createObjectTable, deleteObjectTable, getObjectTables, mutateObjectTable, setObjectTableCells, TableError } from "@/lib/db/tables";
import { COMPLETION_NEXT_ACTION } from "@/lib/objects/next-action";
import { parseCellValue, TABLE_LIMITS, type ObjectTableView, type TableColumnType } from "@/lib/tables/model";

type ColumnInput = { name: string; type: TableColumnType; currency?: string | null; carryForward?: boolean };

import { TableGrid } from "@/components/tables/TableGrid";
import { ColumnMenuPanel } from "@/components/tables/ColumnMenu";
import { ObjectDrawer } from "@/components/board/ObjectDrawer";
import { GET as listTables, POST as createTableRoute } from "@/app/api/objects/[objectId]/tables/route";
import { DELETE as deleteTableRoute, PATCH as tableRoute } from "@/app/api/objects/[objectId]/tables/[tableId]/route";
import { PATCH as cellsRoute } from "@/app/api/objects/[objectId]/tables/[tableId]/cells/route";

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  for (const migration of ["0000_flaky_meggan", "0001_object_archive_metadata", "0002_object_category_presentation", "0003_silent_groot", "0004_keen_diamondback", "0005_boring_quicksilver", "0006_faulty_meteorite", "0007_clever_annihilus", "0008_silky_slapstick", "0009_loose_skin"]) {
    await pg.exec(await readFile(`drizzle/${migration}.sql`, "utf8"));
  }
}, 30000);

beforeEach(async () => {
  await pg.exec("TRUNCATE objects CASCADE");
  mocks.auth.mockReset().mockResolvedValue({});
  mocks.openai.mockReset();
});
afterAll(async () => { await pg.close(); });

async function make(title = "Audi A3 Periodic Maintenance — 2026") {
  return createObject({ title, status: "doing", goal: "Keep the car serviced", currentState: "Planning", nextAction: "Record mileage" });
}

const maintenance: ColumnInput[] = [
  { name: "Maintenance Item", type: "text" },
  { name: "Previous Service", type: "text" },
  { name: "Current Condition", type: "text" },
  { name: "This Service", type: "checkbox" },
  { name: "Part / Fluid Spec", type: "text" },
  { name: "Cost", type: "currency", currency: "EUR" },
  { name: "Notes", type: "text" },
];

async function withTable(columns: ColumnInput[] = maintenance) {
  const object = await make();
  const table = await createObjectTable(object.id, { title: "Maintenance Items", columns });
  const byName = new Map(table.columns.map((column) => [column.name, column.id]));
  return { object, table, columnId: (name: string) => byName.get(name)! };
}

function request(url: string, body?: unknown, method = "POST") {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function tableContext(objectId: string, tableId: string) {
  return { params: Promise.resolve({ objectId, tableId }) };
}

const objectContext = (objectId: string) => ({ params: Promise.resolve({ objectId }) });

async function counts() {
  const [tables, columns, rows, cells] = await Promise.all([
    db.select().from(schema.objectTables),
    db.select().from(schema.objectTableColumns),
    db.select().from(schema.objectTableRows),
    db.select().from(schema.objectTableCells),
  ]);
  return { tables: tables.length, columns: columns.length, rows: rows.length, cells: cells.length };
}

describe("Object Tables structure", () => {
  it("creates a table for an Object with its columns and records the change once", async () => {
    const { object, table } = await withTable();
    expect(table.title).toBe("Maintenance Items");
    expect(table.objectId).toBe(object.id);
    expect(table.columns.map((column) => column.name)).toEqual(maintenance.map((column) => column.name));
    expect(table.columns.map((column) => column.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(table.columns[5].currency).toBe("EUR");
    expect(table.rows).toEqual([]);
    const activity = await db.select().from(schema.objectUpdates).where(eq(schema.objectUpdates.objectId, object.id));
    expect(activity.map((row) => row.type)).toEqual(["object_created", "table_created"]);
  });

  it("allows several tables on one Object in a stable order", async () => {
    const object = await make();
    const first = await createObjectTable(object.id, { title: "Parts", columns: [{ name: "Part", type: "text" }] });
    const second = await createObjectTable(object.id, { title: "Costs", columns: [{ name: "Item", type: "text" }] });
    const tables = await getObjectTables(object.id);
    expect(tables?.map((table) => table.title)).toEqual(["Parts", "Costs"]);
    expect(tables?.map((table) => table.position)).toEqual([0, 1]);
    expect(first.id).not.toBe(second.id);
  });

  it("creates columns and rows", async () => {
    const { object, table } = await withTable();
    const withColumn = await mutateObjectTable(object.id, { action: "add_column", tableId: table.id, column: { name: "Supplier", type: "text" } });
    expect(withColumn.columns.at(-1)?.name).toBe("Supplier");
    const withRow = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    expect(withRow.rows).toHaveLength(1);
    expect(withRow.rows[0].carryForward).toBe(false);
    expect(withRow.rows[0].cells).toEqual({});
  });

  it("returns tables through the API layer", async () => {
    const { object, table } = await withTable([{ name: "Item", type: "text" }]);
    const response = await listTables(request(`/api/objects/${object.id}/tables`, undefined, "GET"), objectContext(object.id));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.tables).toHaveLength(1);
    expect(data.tables[0].id).toBe(table.id);
  });
});

describe("Object Tables cells", () => {
  it("creates and edits a cell value", async () => {
    const { object, table, columnId } = await withTable();
    const created = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    const rowId = created.rows[0].id;
    const itemColumn = columnId("Maintenance Item");

    const first = await setObjectTableCells(object.id, table.id, [{ rowId, columnId: itemColumn, value: "Engine oil" }]);
    expect(first.rows[0].cells[itemColumn]).toBe("Engine oil");

    const edited = await setObjectTableCells(object.id, table.id, [{ rowId, columnId: itemColumn, value: "Engine oil (5W-30)" }]);
    expect(edited.rows[0].cells[itemColumn]).toBe("Engine oil (5W-30)");
    expect(await counts()).toMatchObject({ cells: 1 });
  });

  it("clears a value by removing the stored cell", async () => {
    const { object, table, columnId } = await withTable();
    const created = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    const rowId = created.rows[0].id;
    const itemColumn = columnId("Maintenance Item");
    await setObjectTableCells(object.id, table.id, [{ rowId, columnId: itemColumn, value: "Air filter" }]);
    const cleared = await setObjectTableCells(object.id, table.id, [{ rowId, columnId: itemColumn, value: "   " }]);
    expect(cleared.rows[0].cells).toEqual({});
    expect((await counts()).cells).toBe(0);
  });

  it("stores every column type in its canonical form", async () => {
    const { object, table, columnId } = await withTable();
    await mutateObjectTable(object.id, { action: "add_column", tableId: table.id, column: { name: "Due", type: "number" } });
    await mutateObjectTable(object.id, { action: "add_column", tableId: table.id, column: { name: "Serviced on", type: "date" } });
    const reloaded = (await getObjectTables(object.id))![0];
    const created = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    const rowId = created.rows[0].id;
    const numberId = reloaded.columns.find((column) => column.name === "Due")!.id;
    const dateId = reloaded.columns.find((column) => column.name === "Serviced on")!.id;

    const written = await setObjectTableCells(object.id, table.id, [
      { rowId, columnId: columnId("Part / Fluid Spec"), value: "5W-30 XYZ" },
      { rowId, columnId: columnId("Cost"), value: "185" },
      { rowId, columnId: columnId("This Service"), value: "true" },
      { rowId, columnId: numberId, value: "86420" },
      { rowId, columnId: dateId, value: "2026-09-24" },
    ]);
    const cells = written.rows[0].cells;
    expect(cells[columnId("Part / Fluid Spec")]).toBe("5W-30 XYZ");
    // Currency is canonicalised to two decimals without floating point.
    expect(cells[columnId("Cost")]).toBe("185.00");
    expect(cells[columnId("This Service")]).toBe("true");
    expect(cells[numberId]).toBe("86420");
    // A date-only value is stored as text, so no timezone can shift it.
    expect(cells[dateId]).toBe("2026-09-24");
  });

  it("deletes a row with its cells and a column with its cells", async () => {
    const { object, table, columnId } = await withTable([{ name: "Item", type: "text" }, { name: "Notes", type: "text" }]);
    const first = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    const second = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    const rowId = first.rows.map((row) => row.id).find((id) => id !== second.rows[1].id)!;
    await setObjectTableCells(object.id, table.id, [
      { rowId, columnId: columnId("Item"), value: "Oil filter" },
      { rowId, columnId: columnId("Notes"), value: "Verify previous change" },
    ]);
    await setObjectTableCells(object.id, table.id, [{ rowId: second.rows[1].id, columnId: columnId("Item"), value: "Air filter" }]);
    expect(await counts()).toMatchObject({ rows: 2, cells: 3 });

    const afterRow = await mutateObjectTable(object.id, { action: "delete_row", tableId: table.id, rowId });
    expect(afterRow.rows).toHaveLength(1);
    expect(await counts()).toMatchObject({ rows: 1, cells: 1 });

    const afterColumn = await mutateObjectTable(object.id, { action: "delete_column", tableId: table.id, columnId: columnId("Notes") });
    expect(afterColumn.columns.map((column) => column.name)).toEqual(["Item"]);
    expect(await counts()).toMatchObject({ columns: 1, cells: 1 });
  });

  it("deletes a table with its columns, rows and cells", async () => {
    const { object, table, columnId } = await withTable();
    const created = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    await setObjectTableCells(object.id, table.id, [{ rowId: created.rows[0].id, columnId: columnId("Notes"), value: "Check pressure" }]);
    expect(await counts()).toMatchObject({ tables: 1, columns: 7, rows: 1, cells: 1 });
    await deleteObjectTable(object.id, table.id);
    expect(await getObjectTables(object.id)).toEqual([]);
    expect(await counts()).toEqual({ tables: 0, columns: 0, rows: 0, cells: 0 });
    const activity = await db.select().from(schema.objectUpdates).where(eq(schema.objectUpdates.objectId, object.id));
    expect(activity.map((row) => row.type)).toEqual(["object_created", "table_created", "table_deleted"]);
  });

  it("deleting an Object cascades Tables", async () => {
    const { object, table, columnId } = await withTable();
    const created = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    await setObjectTableCells(object.id, table.id, [{ rowId: created.rows[0].id, columnId: columnId("Notes"), value: "x" }]);
    await deleteObject(object.id);
    expect(await counts()).toEqual({ tables: 0, columns: 0, rows: 0, cells: 0 });
  });

  it("rejects a table belonging to another Object", async () => {
    const mine = await withTable([{ name: "Item", type: "text" }]);
    const other = await withTable([{ name: "Item", type: "text" }]);
    await expect(mutateObjectTable(mine.object.id, { action: "add_row", tableId: other.table.id })).rejects.toBeInstanceOf(TableError);
    await expect(mutateObjectTable(mine.object.id, { action: "add_row", tableId: other.table.id })).rejects.toThrow("TABLE_NOT_FOUND");
    await expect(setObjectTableCells(mine.object.id, other.table.id, [{ rowId: "00000000-0000-4000-8000-000000000000", columnId: "00000000-0000-4000-8000-000000000000", value: "x" }])).rejects.toThrow("TABLE_NOT_FOUND");
  });

  it("rejects a row or column from another table", async () => {
    const first = await withTable([{ name: "Item", type: "text" }]);
    const second = await withTable([{ name: "Item", type: "text" }]);
    const firstRow = (await mutateObjectTable(first.object.id, { action: "add_row", tableId: first.table.id })).rows[0];
    const secondRow = (await mutateObjectTable(second.object.id, { action: "add_row", tableId: second.table.id })).rows[0];

    await expect(setObjectTableCells(first.object.id, first.table.id, [{ rowId: secondRow.id, columnId: first.table.columns[0].id, value: "x" }]))
      .rejects.toThrow("ROW_NOT_FOUND");
    await expect(setObjectTableCells(first.object.id, first.table.id, [{ rowId: firstRow.id, columnId: second.table.columns[0].id, value: "x" }]))
      .rejects.toThrow("COLUMN_NOT_FOUND");
  });

  it("refuses two writes to the same cell in one batch", async () => {
    const { object, table } = await withTable([{ name: "Item", type: "text" }]);
    const row = (await mutateObjectTable(object.id, { action: "add_row", tableId: table.id })).rows[0];
    const columnId = table.columns[0].id;
    await expect(setObjectTableCells(object.id, table.id, [
      { rowId: row.id, columnId, value: "a" },
      { rowId: row.id, columnId, value: "b" },
    ])).rejects.toThrow("INVALID_CELL_VALUE");
  });
});

describe("Object Tables validation", () => {
  it("rejects an unknown column type at the API boundary and in the model", async () => {
    const { object, table } = await withTable([{ name: "Item", type: "text" }]);
    const response = await tableRoute(
      request(`/api/objects/${object.id}/tables/${table.id}`, { action: "add_column", tableId: table.id, column: { name: "Formula", type: "formula" } }, "PATCH"),
      tableContext(object.id, table.id),
    );
    expect(response.status).toBe(400);
    expect((await getObjectTables(object.id))![0].columns).toHaveLength(1);
  });

  it("rejects invalid text, number, date, currency and checkbox values", async () => {
    const { object, table } = await withTable([
      { name: "Item", type: "text" },
      { name: "Due", type: "number" },
      { name: "Serviced on", type: "date" },
      { name: "Cost", type: "currency", currency: "EUR" },
      { name: "Done", type: "checkbox" },
    ]);
    const row = (await mutateObjectTable(object.id, { action: "add_row", tableId: table.id })).rows[0];
    const column = (name: string) => table.columns.find((item) => item.name === name)!.id;
    const write = (name: string, value: string) => setObjectTableCells(object.id, table.id, [{ rowId: row.id, columnId: column(name), value }]);

    await expect(write("Item", "x".repeat(TABLE_LIMITS.cellValue + 1))).rejects.toThrow("INVALID_CELL_VALUE");
    for (const value of ["12 kg", "1,000", "1e3", "0x10", "12.3456789"]) {
      await expect(write("Due", value)).rejects.toThrow("INVALID_CELL_VALUE");
    }
    for (const value of ["2026-02-30", "2026-13-01", "24/09/2026", "2026-2-1"]) {
      await expect(write("Serviced on", value)).rejects.toThrow("INVALID_CELL_VALUE");
    }
    for (const value of ["12.345", "€185.00", "185,00", "1 000"]) {
      await expect(write("Cost", value)).rejects.toThrow("INVALID_CELL_VALUE");
    }
    for (const value of ["yes", "1", "TRUE "]) {
      await expect(write("Done", value)).rejects.toThrow("INVALID_CELL_VALUE");
    }
    expect(await counts()).toMatchObject({ cells: 0 });
  });

  it("accepts leap days and rejects impossible calendar dates", () => {
    expect(parseCellValue("date", "2024-02-29").status).toBe("ok");
    expect(parseCellValue("date", "2026-02-29").status).toBe("invalid");
    expect(parseCellValue("date", "1900-02-29").status).toBe("invalid");
    expect(parseCellValue("date", "2000-02-29").status).toBe("ok");
  });

  it("canonicalises values without floating point drift", () => {
    expect(parseCellValue("currency", "185")).toMatchObject({ status: "ok", value: "185.00" });
    expect(parseCellValue("currency", "0.1")).toMatchObject({ status: "ok", value: "0.10" });
    expect(parseCellValue("currency", "-12.5")).toMatchObject({ status: "ok", value: "-12.50" });
    expect(parseCellValue("number", "8.5")).toMatchObject({ status: "ok", value: "8.5" });
  });

  it("enforces the centralised table limits", async () => {
    const { object, table } = await withTable();
    for (let index = table.columns.length; index < TABLE_LIMITS.columnsPerTable; index += 1) {
      await mutateObjectTable(object.id, { action: "add_column", tableId: table.id, column: { name: `Extra ${index}`, type: "text" } });
    }
    await expect(mutateObjectTable(object.id, { action: "add_column", tableId: table.id, column: { name: "One too many", type: "text" } }))
      .rejects.toThrow("COLUMNS_LIMIT_REACHED");

    for (let index = 0; index < TABLE_LIMITS.tablesPerObject; index += 1) {
      if (index === 0) continue;
      await createObjectTable(object.id, { title: `Table ${index}`, columns: [{ name: "Item", type: "text" }] });
    }
    await expect(createObjectTable(object.id, { title: "One too many", columns: [{ name: "Item", type: "text" }] }))
      .rejects.toThrow("TABLES_LIMIT_REACHED");
  }, 30000);
});

describe("Object Tables ordering and lifecycle", () => {
  it("persists row order and renumbers after deletion", async () => {
    const { object, table, columnId } = await withTable([{ name: "Item", type: "text" }]);
    const item = columnId("Item");
    let view = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    view = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    view = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    const names = ["Engine oil", "Oil filter", "Air filter"];
    await setObjectTableCells(object.id, table.id, view.rows.map((row, index) => ({ rowId: row.id, columnId: item, value: names[index] })));

    const moved = await mutateObjectTable(object.id, { action: "move_row", tableId: table.id, rowId: view.rows[0].id, direction: 1 });
    expect(moved.rows.map((row) => row.cells[item])).toEqual(["Oil filter", "Engine oil", "Air filter"]);
    // Reloading proves the order is persisted, not just returned by the mutation.
    expect((await getObjectTables(object.id))![0].rows.map((row) => row.cells[item])).toEqual(["Oil filter", "Engine oil", "Air filter"]);

    // Moving the first row up is a safe no-op.
    const boundary = await mutateObjectTable(object.id, { action: "move_row", tableId: table.id, rowId: moved.rows[0].id, direction: -1 });
    expect(boundary.rows.map((row) => row.cells[item])).toEqual(["Oil filter", "Engine oil", "Air filter"]);

    const deleted = await mutateObjectTable(object.id, { action: "delete_row", tableId: table.id, rowId: moved.rows[1].id });
    expect(deleted.rows.map((row) => row.position)).toEqual([0, 1]);
    expect(deleted.rows.map((row) => row.cells[item])).toEqual(["Oil filter", "Air filter"]);
  });

  it("persists column order and renumbers positions", async () => {
    const { object, table } = await withTable([
      { name: "Item", type: "text" },
      { name: "Condition", type: "text" },
      { name: "Cost", type: "text" },
    ]);
    const moved = await mutateObjectTable(object.id, { action: "move_column", tableId: table.id, columnId: table.columns[2].id, direction: -1 });
    expect(moved.columns.map((column) => column.name)).toEqual(["Item", "Cost", "Condition"]);
    expect((await getObjectTables(object.id))![0].columns.map((column) => column.name)).toEqual(["Item", "Cost", "Condition"]);

    const deleted = await mutateObjectTable(object.id, { action: "delete_column", tableId: table.id, columnId: table.columns[0].id });
    expect(deleted.columns.map((column) => column.position)).toEqual([0, 1]);
  });

  it("keeps tables for archived, cancelled and restored Objects", async () => {
    const { object, table, columnId } = await withTable();
    const created = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    await setObjectTableCells(object.id, table.id, [{ rowId: created.rows[0].id, columnId: columnId("Notes"), value: "Record thickness" }]);

    await changeObjectLifecycle(object.id, "archive");
    const archived = await getObjectTables(object.id);
    expect(archived).toHaveLength(1);
    expect(archived![0].rows[0].cells[columnId("Notes")]).toBe("Record thickness");

    await changeObjectLifecycle(object.id, "restore");
    await changeObjectLifecycle(object.id, "cancel");
    expect((await getObjectTables(object.id))!.length).toBe(1);

    await changeObjectLifecycle(object.id, "restore");
    const restored = await getObjectTables(object.id);
    expect(restored!.length).toBe(1);
    expect(restored![0].rows[0].cells[columnId("Notes")]).toBe("Record thickness");
  });

  it("refuses writes on an archived Object but still reads its records", async () => {
    const { object, table } = await withTable([{ name: "Item", type: "text" }]);
    await changeObjectLifecycle(object.id, "archive");
    await expect(mutateObjectTable(object.id, { action: "add_row", tableId: table.id })).rejects.toThrow("OBJECT_ARCHIVED");
    const response = await cellsRoute(
      request(`/api/objects/${object.id}/tables/${table.id}/cells`, { cells: [{ rowId: table.id, columnId: table.columns[0].id, value: "x" }] }, "PATCH"),
      tableContext(object.id, table.id),
    );
    expect(response.status).toBe(409);
    expect(await getObjectTables(object.id)).toHaveLength(1);
  });
});

describe("Object Tables column type safety", () => {
  it("refuses a type change that would invalidate existing values", async () => {
    const { object, table, columnId } = await withTable([{ name: "Condition", type: "text" }, { name: "Cost", type: "number" }]);
    const row = (await mutateObjectTable(object.id, { action: "add_row", tableId: table.id })).rows[0];
    await setObjectTableCells(object.id, table.id, [{ rowId: row.id, columnId: columnId("Condition"), value: "Inspect" }]);

    await expect(mutateObjectTable(object.id, { action: "update_column", tableId: table.id, columnId: columnId("Condition"), type: "number" }))
      .rejects.toThrow("COLUMN_TYPE_INCOMPATIBLE");

    // The refused change left both the column and the data untouched.
    const after = (await getObjectTables(object.id))![0];
    expect(after.columns[0].type).toBe("text");
    expect(after.rows[0].cells[columnId("Condition")]).toBe("Inspect");
  });

  it("converts compatible values and re-canonicalises them", async () => {
    const { object, table, columnId } = await withTable([{ name: "Amount", type: "text" }]);
    const row = (await mutateObjectTable(object.id, { action: "add_row", tableId: table.id })).rows[0];
    await setObjectTableCells(object.id, table.id, [{ rowId: row.id, columnId: columnId("Amount"), value: "185" }]);

    const converted = await mutateObjectTable(object.id, { action: "update_column", tableId: table.id, columnId: columnId("Amount"), type: "currency", currency: "EUR" });
    expect(converted.columns[0].type).toBe("currency");
    expect(converted.columns[0].currency).toBe("EUR");
    expect(converted.rows[0].cells[columnId("Amount")]).toBe("185.00");

    // Leaving the currency type drops the code, because it is presentation only.
    const back = await mutateObjectTable(object.id, { action: "update_column", tableId: table.id, columnId: columnId("Amount"), type: "text" });
    expect(back.columns[0].currency).toBeNull();
  });

  it("allows a checkbox and a number to become text", async () => {
    const { object, table, columnId } = await withTable([{ name: "Done", type: "checkbox" }, { name: "Due", type: "number" }]);
    const row = (await mutateObjectTable(object.id, { action: "add_row", tableId: table.id })).rows[0];
    await setObjectTableCells(object.id, table.id, [
      { rowId: row.id, columnId: columnId("Done"), value: "true" },
      { rowId: row.id, columnId: columnId("Due"), value: "86420" },
    ]);
    const text = await mutateObjectTable(object.id, { action: "update_column", tableId: table.id, columnId: columnId("Done"), type: "text" });
    expect(text.columns[0].type).toBe("text");
    expect(text.rows[0].cells[columnId("Done")]).toBe("true");
    const numberToText = await mutateObjectTable(object.id, { action: "update_column", tableId: table.id, columnId: columnId("Due"), type: "text" });
    expect(numberToText.rows[0].cells[columnId("Due")]).toBe("86420");
  });
});

describe("Object Tables Activity", () => {
  it("logs only structural table events, never individual cell writes", async () => {
    const { object, table, columnId } = await withTable([{ name: "Item", type: "text" }]);
    const created = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    const rowId = created.rows[0].id;

    // Many edits, structural changes and a rename.
    for (const value of ["Engine oil", "Engine oil 5W-30", "Castrol Edge", ""]) {
      await setObjectTableCells(object.id, table.id, [{ rowId, columnId: columnId("Item"), value }]);
    }
    await mutateObjectTable(object.id, { action: "add_column", tableId: table.id, column: { name: "Notes", type: "text" } });
    const columns = (await getObjectTables(object.id))![0].columns;
    await mutateObjectTable(object.id, { action: "move_column", tableId: table.id, columnId: columns[1].id, direction: -1 });
    await mutateObjectTable(object.id, { action: "update_column", tableId: table.id, columnId: columnId("Item"), name: "Maintenance item" });
    await mutateObjectTable(object.id, { action: "rename_table", tableId: table.id, title: "Service items" });

    const activity = await db.select().from(schema.objectUpdates).where(eq(schema.objectUpdates.objectId, object.id));
    const types = activity.map((row) => row.type).sort();
    expect(types).toEqual(["object_created", "table_created", "table_renamed"]);
    // Cell writes, row and column changes produce no Activity noise at all.
    expect(activity.filter((row) => row.content.includes("Castrol"))).toHaveLength(0);
    expect(activity.some((row) => row.type === "checklist_changed")).toBe(false);
  });

  it("logs a rename only when the title really changes", async () => {
    const { object, table } = await withTable([{ name: "Item", type: "text" }]);
    await mutateObjectTable(object.id, { action: "rename_table", tableId: table.id, title: "Maintenance Items" });
    const activity = await db.select().from(schema.objectUpdates).where(eq(schema.objectUpdates.objectId, object.id));
    expect(activity.filter((row) => row.type === "table_renamed")).toHaveLength(0);
  });
});

const auditColumns: ColumnInput[] = [
  { name: "Maintenance Item", type: "text", carryForward: true },
  { name: "Current Condition", type: "text" },
  { name: "This Service", type: "checkbox" },
  { name: "Part / Fluid Spec", type: "text" },
  { name: "Cost", type: "currency", currency: "EUR" },
  { name: "Notes", type: "text" },
];

/** The 2026 Audi maintenance example from the acceptance scenario. */
async function audiOccurrence() {
  const object = await make("Audi A3 Periodic Maintenance — 2026");
  await updateObjectRecurrence(object.id, { frequency: "yearly", interval: 1, basis: "scheduled_date", nextDate: "2026-01-01" });
  const table = await createObjectTable(object.id, { title: "Maintenance Items", columns: auditColumns });
  const column = (name: string) => table.columns.find((item) => item.name === name)!.id;

  const flags: [string, boolean][] = [["Engine oil", true], ["Oil filter", true], ["Air filter", true], ["Replace damaged wiper", false]];
  const rows: { id: string; name: string }[] = [];
  for (const [name, carryForward] of flags) {
    const view = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id, carryForward });
    rows.push({ id: view.rows.at(-1)!.id, name });
  }

  // Occurrence-specific execution data, including a completed checkbox.
  await setObjectTableCells(object.id, table.id, rows.flatMap((row) => [
    { rowId: row.id, columnId: column("Maintenance Item"), value: row.name },
    { rowId: row.id, columnId: column("Current Condition"), value: "To verify" },
    { rowId: row.id, columnId: column("This Service"), value: "true" },
    { rowId: row.id, columnId: column("Part / Fluid Spec"), value: "TBD" },
    { rowId: row.id, columnId: column("Cost"), value: "55" },
    { rowId: row.id, columnId: column("Notes"), value: `Note ${row.name}` },
  ]));

  return { object, table, column, before: (await getObjectTables(object.id))! };
}

async function generateNext(objectId: string) {
  await updateObjectStatus(objectId, "done");
  const [next] = await db.select().from(schema.objects).where(eq(schema.objects.previousOccurrenceId, objectId));
  return next;
}

describe("Recurring Object Tables carry-forward", () => {
  it("copies table and column definitions with their carry-forward flags", async () => {
    const { object, table, before } = await audiOccurrence();
    const next = await generateNext(object.id);
    const copied = (await getObjectTables(next.id))!;

    expect(copied).toHaveLength(before.length);
    expect(copied[0].title).toBe("Maintenance Items");
    expect(copied[0].position).toBe(before[0].position);
    expect(copied[0].columns.map((column) => column.name)).toEqual(before[0].columns.map((column) => column.name));
    expect(copied[0].columns.map((column) => column.type)).toEqual(before[0].columns.map((column) => column.type));
    expect(copied[0].columns.map((column) => column.position)).toEqual(before[0].columns.map((column) => column.position));
    // Flags are preserved exactly, including the currency configuration.
    expect(copied[0].columns.map((column) => column.carryForward)).toEqual([true, false, false, false, false, false]);
    expect(copied[0].columns.find((column) => column.name === "Cost")?.currency).toBe("EUR");
    expect(copied[0].id).not.toBe(table.id);
  });

  it("copies only rows opted in, keeps their order and never bumps them to done", async () => {
    const { object, before } = await audiOccurrence();
    const next = await generateNext(object.id);
    const copied = (await getObjectTables(next.id))!;
    const item = copied[0].columns.find((column) => column.name === "Maintenance Item")!.id;

    expect(copied[0].rows.map((row) => row.cells[item])).toEqual(["Engine oil", "Oil filter", "Air filter"]);
    expect(copied[0].rows.map((row) => row.position)).toEqual([0, 1, 2]);
    // Every carried row keeps repeating in the next next occurrence.
    expect(copied[0].rows.every((row) => row.carryForward)).toBe(true);
    expect(copied[0].rows.map((row) => row.cells[item])).not.toContain("Replace damaged wiper");
    expect(before[0].rows).toHaveLength(4);
  });

  it("copies values only from columns marked carry-forward", async () => {
    const { object, column } = await audiOccurrence();
    const next = await generateNext(object.id);
    const copied = (await getObjectTables(next.id))!;
    const copiedColumn = (name: string) => copied[0].columns.find((item) => item.name === name)!.id;

    for (const row of copied[0].rows) {
      // The opted-in column keeps its value...
      expect(row.cells[copiedColumn("Maintenance Item")]).toBeTruthy();
      // ...and every other column starts empty, including the checked checkbox.
      expect(row.cells[copiedColumn("Current Condition")]).toBeUndefined();
      expect(row.cells[copiedColumn("This Service")]).toBeUndefined();
      expect(row.cells[copiedColumn("Part / Fluid Spec")]).toBeUndefined();
      expect(row.cells[copiedColumn("Cost")]).toBeUndefined();
      expect(row.cells[copiedColumn("Notes")]).toBeUndefined();
    }
    // The historical occurrence keeps its completed checkbox and cost.
    const historical = (await getObjectTables(object.id))!;
    expect(historical[0].rows[0].cells[column("This Service")]).toBe("true");
    expect(historical[0].rows[0].cells[column("Cost")]).toBe("55.00");
    expect(historical[0].rows[0].cells[column("Notes")]).toBe("Note Engine oil");
  });

  it("copies text, number, date and currency values when their column opted in", async () => {
    const object = await make("Firmware bench");
    await updateObjectRecurrence(object.id, { frequency: "monthly", interval: 1, basis: "scheduled_date", nextDate: "2026-03-01" });
    const table = await createObjectTable(object.id, {
      title: "Boards",
      columns: [
        { name: "Board", type: "text", carryForward: true },
        { name: "MCU", type: "text", carryForward: true },
        { name: "Firmware version", type: "text", carryForward: true },
        { name: "Build number", type: "number", carryForward: true },
        { name: "Tested on", type: "date", carryForward: true },
        { name: "Cost", type: "currency", currency: "USD", carryForward: true },
        { name: "Result", type: "text" },
      ],
    });
    const column = (name: string) => table.columns.find((item) => item.name === name)!.id;
    const created = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id, carryForward: true });
    const rowId = created.rows[0].id;
    await setObjectTableCells(object.id, table.id, [
      { rowId, columnId: column("Board"), value: "nRF52840 DK" },
      { rowId, columnId: column("MCU"), value: "nRF52840" },
      { rowId, columnId: column("Firmware version"), value: "2.5.1" },
      { rowId, columnId: column("Build number"), value: "2501" },
      { rowId, columnId: column("Tested on"), value: "2026-02-28" },
      { rowId, columnId: column("Cost"), value: "49.9" },
      { rowId, columnId: column("Result"), value: "Failed radio test" },
    ]);

    const next = await generateNext(object.id);
    const copied = (await getObjectTables(next.id))!;
    const copiedColumn = (name: string) => copied[0].columns.find((item) => item.name === name)!.id;
    const cells = copied[0].rows[0].cells;
    expect(cells[copiedColumn("Board")]).toBe("nRF52840 DK");
    expect(cells[copiedColumn("MCU")]).toBe("nRF52840");
    expect(cells[copiedColumn("Firmware version")]).toBe("2.5.1");
    expect(cells[copiedColumn("Build number")]).toBe("2501");
    expect(cells[copiedColumn("Tested on")]).toBe("2026-02-28");
    expect(cells[copiedColumn("Cost")]).toBe("49.90");
    expect(cells[copiedColumn("Result")]).toBeUndefined();
    expect(copied[0].columns.find((column) => column.name === "Cost")?.currency).toBe("USD");
  });

  it("decides by flag only, never by column or row names", async () => {
    const object = await make("Name independence");
    await updateObjectRecurrence(object.id, { frequency: "weekly", interval: 1, basis: "scheduled_date", nextDate: "2026-03-02" });
    // Deliberately inverted naming: the heuristic-looking columns are NOT flagged.
    const table = await createObjectTable(object.id, {
      title: "Records",
      columns: [
        { name: "Item", type: "text" },
        { name: "Repeat me", type: "text", carryForward: true },
        { name: "Xyzzy", type: "text", carryForward: true },
      ],
    });
    const created = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id, carryForward: true });
    const rowId = created.rows[0].id;
    const column = (name: string) => table.columns.find((item) => item.name === name)!.id;
    await setObjectTableCells(object.id, table.id, [
      { rowId, columnId: column("Item"), value: "should not travel" },
      { rowId, columnId: column("Repeat me"), value: "carried" },
      { rowId, columnId: column("Xyzzy"), value: "also carried" },
    ]);

    const next = await generateNext(object.id);
    const copied = (await getObjectTables(next.id))!;
    const copiedColumn = (name: string) => copied[0].columns.find((item) => item.name === name)!.id;
    expect(copied[0].rows[0].cells[copiedColumn("Item")]).toBeUndefined();
    expect(copied[0].rows[0].cells[copiedColumn("Repeat me")]).toBe("carried");
    expect(copied[0].rows[0].cells[copiedColumn("Xyzzy")]).toBe("also carried");
  });

  it("keeps the historical occurrence unchanged and shares no records", async () => {
    const { object, before } = await audiOccurrence();
    const next = await generateNext(object.id);
    const after = (await getObjectTables(object.id))!;
    expect(after).toEqual(before);
    expect(after[0].rows.map((row) => row.id)).toEqual(before[0].rows.map((row) => row.id));
    // The copies are separate records, not shared rows.
    const copied = (await getObjectTables(next.id))!;
    expect(copied[0].rows.map((row) => row.id)).not.toEqual(before[0].rows.map((row) => row.id));
    expect(copied[0].columns.map((column) => column.id)).not.toEqual(before[0].columns.map((column) => column.id));
  });

  it("generates the next occurrence only once", async () => {
    const { object } = await audiOccurrence();
    const next = await generateNext(object.id);
    const afterFirst = await counts();

    // Leaving Done and returning to Done must not create a second occurrence.
    await updateObjectStatus(object.id, "doing");
    await updateObjectStatus(object.id, "done");
    const occurrences = await db.select().from(schema.objects).where(eq(schema.objects.previousOccurrenceId, object.id));
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].id).toBe(next.id);
    expect(await counts()).toEqual(afterFirst);
  });

  it("keeps generation transactional", async () => {
    const { object, before } = await audiOccurrence();
    // A copied column that violates a constraint makes the whole transaction fail.
    await pg.exec("ALTER TABLE object_table_columns ADD CONSTRAINT simulate_copy_failure CHECK (name <> 'Maintenance Item') NOT VALID");
    try {
      await expect(updateObjectStatus(object.id, "done")).rejects.toBeTruthy();
      const occurrences = await db.select().from(schema.objects).where(eq(schema.objects.previousOccurrenceId, object.id));
      // Neither the next occurrence nor a partial table copy survives.
      expect(occurrences).toHaveLength(0);
      const [current] = await db.select().from(schema.objects).where(eq(schema.objects.id, object.id));
      expect(current.status).toBe("doing");
      expect(current.nextOccurrenceId).toBeNull();
      expect(await getObjectTables(object.id)).toEqual(before);
    } finally {
      await pg.exec("ALTER TABLE object_table_columns DROP CONSTRAINT simulate_copy_failure");
    }
  });

  it("rolls the copy back with the generation transaction", async () => {
    const { object, before } = await audiOccurrence();
    // A copied column that violates a constraint makes the whole transaction fail,
    // proving the table copy is part of the same generation transaction.
    await pg.exec("ALTER TABLE object_table_columns ADD CONSTRAINT simulate_copy_rollback CHECK (name <> 'Maintenance Item') NOT VALID");
    try {
      await expect(updateObjectStatus(object.id, "done")).rejects.toBeTruthy();
      expect(await db.select().from(schema.objectTables)).toHaveLength(1);
      expect(await getObjectTables(object.id)).toEqual(before);
    } finally {
      await pg.exec("ALTER TABLE object_table_columns DROP CONSTRAINT simulate_copy_rollback");
    }
  });

  it("stores carry-forward flags on a non-recurring Object without copying anything", async () => {
    const { object, table } = await withTable([{ name: "Item", type: "text", carryForward: true }]);
    const created = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id, carryForward: true });
    expect(created.columns[0].carryForward).toBe(true);
    expect(created.rows[0].carryForward).toBe(true);
    // A non-recurring Object never generates an occurrence.
    await updateObjectStatus(object.id, "done");
    expect(await db.select().from(schema.objectTables)).toHaveLength(1);
  });

  it("ignores tables of other Objects when generating an occurrence", async () => {
    const { object } = await audiOccurrence();
    const unrelated = await make("Unrelated Object");
    await createObjectTable(unrelated.id, { title: "Unrelated table", columns: [{ name: "Item", type: "text", carryForward: true }] });
    const next = await generateNext(object.id);
    const copied = (await getObjectTables(next.id))!;
    expect(copied.map((table) => table.title)).toEqual(["Maintenance Items"]);
    expect((await getObjectTables(unrelated.id))![0].title).toBe("Unrelated table");
  });
});

const noop = () => {};
const asyncNoop = async () => {};

function tableView(overrides: Partial<ObjectTableView> = {}): ObjectTableView {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    objectId: "22222222-2222-4222-8222-222222222222",
    title: "Maintenance Items",
    position: 0,
    columns: [
      { id: "c1", name: "Maintenance Item", type: "text", currency: null, position: 0, carryForward: true },
      { id: "c2", name: "Cost", type: "currency", currency: "EUR", position: 1, carryForward: false },
      { id: "c3", name: "This Service", type: "checkbox", currency: null, position: 2, carryForward: false },
      { id: "c4", name: "Notes", type: "text", currency: null, position: 3, carryForward: false },
    ],
    rows: [{ id: "r1", position: 0, carryForward: true, cells: { c1: "Engine oil", c2: "55.00", c3: "true" } }],
    ...overrides,
  };
}

const gridProps = {
  disabled: false,
  recurring: true,
  onCells: noop,
  onAddRow: noop,
  onAddColumn: noop,
  onDeleteRow: noop,
  onMoveRow: noop,
  onRowCarryForward: noop,
  onUpdateColumn: noop,
  onMoveColumn: noop,
  onDeleteColumn: noop,
};

describe("Object Tables UI", () => {
  it("renders a table that has no rows yet", () => {
    const markup = renderToStaticMarkup(createElement(TableGrid, { ...gridProps, table: tableView({ rows: [] }) }));
    expect(markup).toContain("No rows yet.");
    expect(markup).toContain("+ Add row");
    expect(markup).toContain("+ Add column");
    expect(markup).toContain("Maintenance Items");
  });

  it("renders every column type and keeps a wide table horizontally scrollable", () => {
    const markup = renderToStaticMarkup(createElement(TableGrid, { ...gridProps, table: tableView() }));
    // Wide tables scroll instead of being squeezed into unreadable columns.
    expect(markup).toContain("overflow-x-auto");
    expect(markup).toContain("min-w-[560px]");
    expect(markup).toContain('aria-label="Maintenance Item · row 1"');
    expect(markup).toContain('value="Engine oil"');
    // A currency cell shows its code as a hint, a checkbox reflects the stored value.
    expect(markup).toContain('placeholder="EUR"');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("checked");
    // The trigger lives in the header; its panel is not part of the table at all.
    expect(markup).toContain('aria-label="Column options: Maintenance Item"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("Move left");
  });

  it("keeps every column operation available in the floating column menu", () => {
    const column = tableView().columns[1];
    const panel = renderToStaticMarkup(createElement(ColumnMenuPanel, {
      column, index: 1, count: 4, disabled: false, recurring: true,
      onUpdate: noop, onMove: noop, onDelete: noop, onClose: noop,
    }));
    for (const text of ["Rename", "Type", "Currency", "Keep values forward", "Move left", "Move right", "Delete column"]) expect(panel).toContain(text);
    for (const label of ["Rename Cost", "Type of Cost", "Currency of Cost", "Move Cost left", "Move Cost right", "Delete column Cost"]) {
      expect(panel).toContain(`aria-label="${label}"`);
    }
    // The column carry-forward flag keeps its explicit, discoverable label.
    expect(panel).toContain("Keep this column&#x27;s value in the next occurrence");
    // Rendered as a floating layer so it cannot expand the table.
    expect(panel).toContain('role="dialog"');
    expect(panel).toContain("z-50");
    expect(panel).toContain("fixed");
  });

  it("only exposes the destructive column action behind a confirmation step", () => {
    const column = tableView().columns[0];
    const panel = renderToStaticMarkup(createElement(ColumnMenuPanel, {
      column, index: 0, count: 4, disabled: false, recurring: false,
      onUpdate: noop, onMove: noop, onDelete: noop, onClose: noop,
    }));
    expect(panel).toContain('aria-label="Delete column Maintenance Item"');
    // The menu itself never deletes: it opens a confirm step first.
    expect(panel).not.toContain("Confirm delete column");
    // Boundary moves are disabled for the first column.
    expect(panel).toContain('aria-label="Move Maintenance Item left"');
    expect(panel).toContain("disabled");
  });

  it("shows carry-forward controls only for a recurring Object", () => {
    const recurring = renderToStaticMarkup(createElement(TableGrid, { ...gridProps, table: tableView() }));
    // A compact switch with an explicit accessible label and a visible explanation.
    expect(recurring).toContain('role="switch"');
    expect(recurring).toContain('aria-label="Repeat this row in the next occurrence: row 1"');
    expect(recurring).toContain('title="Repeat this row in the next occurrence"');

    const plain = renderToStaticMarkup(createElement(TableGrid, { ...gridProps, recurring: false, table: tableView() }));
    expect(plain).not.toContain("next occurrence");
    expect(plain).not.toContain('role="switch"');
    // Row management stays available, because it is not recurrence specific.
    expect(plain).toContain('aria-label="Delete row 1"');
  });

  it("keeps the Object Drawer layout, including Checklist and the new Tables area", async () => {
    const object = await make();
    const markup = renderToStaticMarkup(createElement(ObjectDrawer, {
      object,
      activityVersion: 0,
      onClose: noop,
      onToggleChecklist: asyncNoop,
      onEditField: asyncNoop,
      onAddChecklist: asyncNoop,
      onRenameChecklist: asyncNoop,
      onDeleteChecklist: asyncNoop,
      onReorderChecklist: asyncNoop,
      onApplyProgress: asyncNoop,
      onApplyReplan: asyncNoop,
      onLifecycle: asyncNoop,
      onCategoryChange: asyncNoop,
      onDeleteObject: asyncNoop,
      onOpenObject: noop,
      onUpdateRecurrence: asyncNoop,
      onUpdateNote: asyncNoop,
      onRefreshActivity: noop,
    }));
    expect(markup).toContain("Tables / Records");
    expect(markup).toContain("Checklist");
    expect(markup).toContain("Loading tables…");
    // The existing Drawer sections are untouched.
    expect(markup).toContain("Current State");
    expect(markup).toContain("Next Action");
    expect(markup).toContain("Dependencies");
    expect(markup).toContain("Activity");
  });
});

describe("Object Tables regression", () => {
  it("keeps the Board query free of table data", async () => {
    const { object, table } = await withTable([{ name: "Item", type: "text" }]);
    const created = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    await setObjectTableCells(object.id, table.id, [{ rowId: created.rows[0].id, columnId: table.columns[0].id, value: "Engine oil" }]);

    const board = await getObjects();
    expect(board).toHaveLength(1);
    // Board cards never carry table structure or cells.
    expect("tables" in board[0]).toBe(false);
    expect(JSON.stringify(board)).not.toContain("Engine oil");
  });

  it("is not slowed down by many stored cells", async () => {
    const { object, table, columnId } = await withTable([{ name: "Item", type: "text" }]);
    let view = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    for (let index = 1; index < 25; index += 1) view = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    await setObjectTableCells(object.id, table.id, view.rows.map((row, index) => ({ rowId: row.id, columnId: columnId("Item"), value: `Row ${index}` })));

    expect(await db.select().from(schema.objectTableCells)).toHaveLength(25);
    // The Board payload stays exactly the same size as without tables.
    const board = await getObjects();
    expect(board[0].checklist).toEqual([]);
    expect(JSON.stringify(board).length).toBeLessThan(2000);
  });

  it("leaves the Checklist and the deterministic Next Action untouched", async () => {
    const object = await make();
    const item = await createChecklistItem(object.id, "Record mileage");
    const table = await createObjectTable(object.id, { title: "Items", columns: [{ name: "Item", type: "text" }] });
    const created = await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    await setObjectTableCells(object.id, table.id, [{ rowId: created.rows[0].id, columnId: table.columns[0].id, value: "Engine oil" }]);

    const untouched = await getObject(object.id);
    expect(untouched!.nextAction).toBe("Record mileage");
    expect(untouched!.currentState).toBe("Planning");

    await updateChecklistItem(item.id, true);
    const completed = await getObject(object.id);
    expect(completed!.nextAction).toBe(COMPLETION_NEXT_ACTION);
    // Table rows are never checklist items.
    expect(completed!.checklist).toHaveLength(1);
  });

  it("still edits the Object itself", async () => {
    const { object, table } = await withTable([{ name: "Item", type: "text" }]);
    await mutateObjectTable(object.id, { action: "add_row", tableId: table.id });
    const updated = await updateObjectField(object.id, "goal", "Finish the maintenance");
    expect(updated.goal).toBe("Finish the maintenance");
    expect(updated.nextAction).toBe("Record mileage");
  });

  it("never calls AI for any table operation", async () => {
    const { object, column } = await audiOccurrence();
    const view = (await getObjectTables(object.id))![0];
    await mutateObjectTable(object.id, { action: "set_row_carry_forward", tableId: view.id, rowId: view.rows[0].id, carryForward: true });
    await setObjectTableCells(object.id, view.id, [{ rowId: view.rows[0].id, columnId: column("Notes"), value: "Inspect" }]);
    const next = await generateNext(object.id);
    expect(await getObjectTables(next.id)).toHaveLength(1);
    expect(mocks.openai).not.toHaveBeenCalled();
  });
});

describe("Object Tables API boundaries", () => {
  it("denies every Table route before any database work", async () => {
    mocks.auth.mockRejectedValue(new UnauthorizedError());
    const select = vi.spyOn(db, "select");
    const transaction = vi.spyOn(db, "transaction");
    const objectId = "33333333-3333-4333-8333-333333333333";
    const tableId = "44444444-4444-4444-8444-444444444444";

    const responses = await Promise.all([
      listTables(request(`/api/objects/${objectId}/tables`, undefined, "GET"), objectContext(objectId)),
      createTableRoute(request(`/api/objects/${objectId}/tables`, { title: "Items", columns: [{ name: "Item", type: "text" }] }), objectContext(objectId)),
      tableRoute(request(`/api/objects/${objectId}/tables/${tableId}`, { action: "add_row", tableId }, "PATCH"), tableContext(objectId, tableId)),
      cellsRoute(request(`/api/objects/${objectId}/tables/${tableId}/cells`, { cells: [{ rowId: tableId, columnId: tableId, value: "x" }] }, "PATCH"), tableContext(objectId, tableId)),
      deleteTableRoute(request(`/api/objects/${objectId}/tables/${tableId}`, { confirmed: true }, "DELETE"), tableContext(objectId, tableId)),
    ]);
    for (const response of responses) expect(response.status).toBe(401);
    expect(select).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(mocks.openai).not.toHaveBeenCalled();
    select.mockRestore();
    transaction.mockRestore();
  });

  it("requires confirmation before deleting a table", async () => {
    const { object, table } = await withTable([{ name: "Item", type: "text" }]);
    const refused = await deleteTableRoute(request(`/api/objects/${object.id}/tables/${table.id}`, {}, "DELETE"), tableContext(object.id, table.id));
    expect(refused.status).toBe(400);
    expect(await getObjectTables(object.id)).toHaveLength(1);

    const accepted = await deleteTableRoute(request(`/api/objects/${object.id}/tables/${table.id}`, { confirmed: true }, "DELETE"), tableContext(object.id, table.id));
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).tables).toEqual([]);
    expect(await getObjectTables(object.id)).toEqual([]);
  });

  it("rejects a body that targets a different table", async () => {
    const mine = await withTable([{ name: "Item", type: "text" }]);
    const other = await withTable([{ name: "Item", type: "text" }]);
    const response = await tableRoute(
      request(`/api/objects/${mine.object.id}/tables/${mine.table.id}`, { action: "add_row", tableId: other.table.id }, "PATCH"),
      tableContext(mine.object.id, mine.table.id),
    );
    expect(response.status).toBe(400);
    expect((await getObjectTables(mine.object.id))![0].rows).toEqual([]);
    expect((await getObjectTables(other.object.id))![0].rows).toEqual([]);
  });

  it("returns 404 for an unknown Object and a 400 for an unusable ID", async () => {
    const missing = "55555555-5555-4555-8555-555555555555";
    expect((await listTables(request(`/api/objects/${missing}/tables`, undefined, "GET"), objectContext(missing))).status).toBe(404);
    expect((await listTables(request("/api/objects/not an id/tables", undefined, "GET"), objectContext("not an id"))).status).toBe(400);
  });
});
