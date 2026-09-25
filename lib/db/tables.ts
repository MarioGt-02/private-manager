/**
 * Object Tables data access.
 *
 * Note: this module intentionally has no `server-only` guard, because
 * `lib/db/queries.ts` imports it for recurring copy support and `queries.ts`
 * itself stays ungarded like its siblings (`archive.ts`, `categories.ts`,
 * `export.ts`). It is only ever reached from server code.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./index";
import { objectTableCells, objectTableColumns, objectTableRows, objectTables, objectUpdates, objects } from "./schema";
import {
  parseCellValue,
  TABLE_LIMITS,
  type ObjectTableView,
  type TableColumnType,
  type TableColumnView,
  type TableDetailMutation,
  type TableRowView,
} from "@/lib/tables/model";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

type TableRowRecord = typeof objectTables.$inferSelect;
type ColumnRecord = typeof objectTableColumns.$inferSelect;
type DataRowRecord = typeof objectTableRows.$inferSelect;

export type TableErrorCode =
  | "OBJECT_NOT_FOUND"
  | "OBJECT_ARCHIVED"
  | "TABLE_NOT_FOUND"
  | "ROW_NOT_FOUND"
  | "COLUMN_NOT_FOUND"
  | "TABLES_LIMIT_REACHED"
  | "COLUMNS_LIMIT_REACHED"
  | "ROWS_LIMIT_REACHED"
  | "INVALID_CELL_VALUE"
  | "COLUMN_TYPE_INCOMPATIBLE";

export class TableError extends Error {
  constructor(public readonly code: TableErrorCode) {
    super(code);
    this.name = "TableError";
  }
}

/** Deterministic document order for every list inside a table. */
const columnOrder = [asc(objectTableColumns.position), asc(objectTableColumns.createdAt), asc(objectTableColumns.id)];
const rowOrder = [asc(objectTableRows.position), asc(objectTableRows.createdAt), asc(objectTableRows.id)];

function toColumnView(row: ColumnRecord): TableColumnView {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency ?? null,
    position: row.position,
    carryForward: row.carryForward,
  };
}

/**
 * Load tables with their columns, rows and cells in four queries total, so a
 * Drawer with several tables never becomes an N+1 query pattern.
 */
async function loadTableViews(queryable: Queryable, objectId: string, tableId?: string): Promise<ObjectTableView[]> {
  const tableRows = await queryable
    .select()
    .from(objectTables)
    .where(tableId ? and(eq(objectTables.objectId, objectId), eq(objectTables.id, tableId)) : eq(objectTables.objectId, objectId))
    .orderBy(asc(objectTables.position), asc(objectTables.createdAt), asc(objectTables.id));
  if (!tableRows.length) return [];

  const ids = tableRows.map((row) => row.id);
  const columnRows = await queryable.select().from(objectTableColumns).where(inArray(objectTableColumns.tableId, ids)).orderBy(...columnOrder);
  const dataRowRecords = await queryable.select().from(objectTableRows).where(inArray(objectTableRows.tableId, ids)).orderBy(...rowOrder);
  const columnIds = columnRows.map((row) => row.id);
  const cellRows = columnIds.length
    ? await queryable.select().from(objectTableCells).where(inArray(objectTableCells.columnId, columnIds))
    : [];

  const cellsByRow = new Map<string, Record<string, string>>();
  for (const cell of cellRows) {
    const values = cellsByRow.get(cell.rowId) ?? {};
    values[cell.columnId] = cell.value;
    cellsByRow.set(cell.rowId, values);
  }

  return tableRows.map((table) => ({
    id: table.id,
    objectId: table.objectId,
    title: table.title,
    position: table.position,
    columns: columnRows.filter((column) => column.tableId === table.id).map(toColumnView),
    rows: dataRowRecords
      .filter((row) => row.tableId === table.id)
      .map((row): TableRowView => ({
        id: row.id,
        position: row.position,
        carryForward: row.carryForward,
        cells: cellsByRow.get(row.id) ?? {},
      })),
  }));
}

/** Every Object Table with structure and records; `null` when the Object is gone. */
export async function getObjectTables(objectId: string): Promise<ObjectTableView[] | null> {
  const db = getDb();
  const [object] = await db.select({ id: objects.id }).from(objects).where(eq(objects.id, objectId)).limit(1);
  if (!object) return null;
  return loadTableViews(db, objectId);
}

async function requireTableView(objectId: string, tableId: string): Promise<ObjectTableView> {
  const [table] = await loadTableViews(getDb(), objectId, tableId);
  if (!table) throw new TableError("TABLE_NOT_FOUND");
  return table;
}

/** Locks the Object row and refuses writes on archived or cancelled Objects. */
async function lockWritableObject(tx: Tx, objectId: string) {
  const [object] = await tx.select().from(objects).where(eq(objects.id, objectId)).for("update");
  if (!object) throw new TableError("OBJECT_NOT_FOUND");
  if (object.archivedAt) throw new TableError("OBJECT_ARCHIVED");
  return object;
}

/** Resolves a Table inside its Object; a Table of another Object is "not found". */
async function requireTable(tx: Tx, objectId: string, tableId: string): Promise<TableRowRecord> {
  const [table] = await tx
    .select()
    .from(objectTables)
    .where(and(eq(objectTables.id, tableId), eq(objectTables.objectId, objectId)))
    .for("update");
  if (!table) throw new TableError("TABLE_NOT_FOUND");
  return table;
}

async function orderedColumns(tx: Tx, tableId: string): Promise<ColumnRecord[]> {
  return tx.select().from(objectTableColumns).where(eq(objectTableColumns.tableId, tableId)).orderBy(...columnOrder);
}

async function orderedRows(tx: Tx, tableId: string): Promise<DataRowRecord[]> {
  return tx.select().from(objectTableRows).where(eq(objectTableRows.tableId, tableId)).orderBy(...rowOrder);
}

async function normalizePositions(tx: Tx, tableId: string, kind: "column" | "row") {
  const rows = kind === "column" ? await orderedColumns(tx, tableId) : await orderedRows(tx, tableId);
  for (const [position, row] of rows.entries()) {
    if (row.position === position) continue;
    if (kind === "column") await tx.update(objectTableColumns).set({ position }).where(eq(objectTableColumns.id, row.id));
    else await tx.update(objectTableRows).set({ position }).where(eq(objectTableRows.id, row.id));
  }
}

/** Currency is presentation only and meaningless for every other column type. */
function toColumnValues(column: { name: string; type: TableColumnType; currency?: string | null; carryForward?: boolean }) {
  return {
    name: column.name,
    type: column.type,
    currency: column.type === "currency" ? column.currency ?? null : null,
    carryForward: column.carryForward ?? false,
  };
}

/** Insert many rows in bounded batches so a large copy stays inside parameter limits. */
async function insertInChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>, size = 500) {
  for (let index = 0; index < rows.length; index += size) {
    await insert(rows.slice(index, index + size));
  }
}

/** Create a Table with its starting columns. Logged once, as a structural change. */
export async function createObjectTable(
  objectId: string,
  input: { title: string; columns: { name: string; type: TableColumnType; currency?: string | null; carryForward?: boolean }[] },
): Promise<ObjectTableView> {
  const db = getDb();
  const tableId = randomUUID();
  await db.transaction(async (tx) => {
    await lockWritableObject(tx, objectId);
    const existing = await tx.select({ id: objectTables.id }).from(objectTables).where(eq(objectTables.objectId, objectId));
    if (existing.length >= TABLE_LIMITS.tablesPerObject) throw new TableError("TABLES_LIMIT_REACHED");
    if (input.columns.length > TABLE_LIMITS.columnsPerTable) throw new TableError("COLUMNS_LIMIT_REACHED");

    await tx.insert(objectTables).values({ id: tableId, objectId, title: input.title, position: existing.length });
    await tx.insert(objectTableColumns).values(
      input.columns.map((column, position) => ({ id: randomUUID(), tableId, position, ...toColumnValues(column) })),
    );
    await tx.insert(objectUpdates).values({
      id: randomUUID(),
      objectId,
      type: "table_created",
      content: `Created table "${input.title}".`,
    });
  });
  return requireTableView(objectId, tableId);
}

/** Delete a Table; columns, rows and cells are removed by foreign key cascade. */
export async function deleteObjectTable(objectId: string, tableId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await lockWritableObject(tx, objectId);
    const table = await requireTable(tx, objectId, tableId);
    await tx.delete(objectTables).where(eq(objectTables.id, tableId));
    const remaining = await tx
      .select({ id: objectTables.id })
      .from(objectTables)
      .where(eq(objectTables.objectId, objectId))
      .orderBy(asc(objectTables.position), asc(objectTables.createdAt), asc(objectTables.id));
    for (const [position, row] of remaining.entries()) {
      await tx.update(objectTables).set({ position }).where(eq(objectTables.id, row.id));
    }
    await tx.insert(objectUpdates).values({
      id: randomUUID(),
      objectId,
      type: "table_deleted",
      content: `Deleted table "${table.title}".`,
    });
  });
}

/**
 * A column type change is allowed only when every stored value in the column
 * already validates for the target type. Otherwise the change is refused with
 * `COLUMN_TYPE_INCOMPATIBLE`, so a type change can never silently destroy data.
 * Values that convert cleanly are re-canonicalised in the same transaction.
 */
async function convertColumnValues(tx: Tx, column: ColumnRecord, nextType: TableColumnType) {
  const cells = await tx.select().from(objectTableCells).where(eq(objectTableCells.columnId, column.id));
  const converted: { id: string; value: string }[] = [];
  for (const cell of cells) {
    const parsed = parseCellValue(nextType, cell.value);
    if (parsed.status !== "ok") throw new TableError("COLUMN_TYPE_INCOMPATIBLE");
    if (parsed.value !== cell.value) converted.push({ id: cell.id, value: parsed.value });
  }
  const now = new Date();
  for (const cell of converted) {
    await tx.update(objectTableCells).set({ value: cell.value, updatedAt: now }).where(eq(objectTableCells.id, cell.id));
  }
}

async function moveInOrder(tx: Tx, tableId: string, itemId: string, direction: -1 | 1, kind: "column" | "row") {
  const items = kind === "column" ? await orderedColumns(tx, tableId) : await orderedRows(tx, tableId);
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) throw new TableError(kind === "column" ? "COLUMN_NOT_FOUND" : "ROW_NOT_FOUND");
  const target = index + direction;
  // Moving past either boundary is a safe no-op rather than an error.
  if (target < 0 || target >= items.length) return;
  const reordered = [...items];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  const now = new Date();
  for (const [position, item] of reordered.entries()) {
    if (kind === "column") await tx.update(objectTableColumns).set({ position, updatedAt: now }).where(eq(objectTableColumns.id, item.id));
    else await tx.update(objectTableRows).set({ position, updatedAt: now }).where(eq(objectTableRows.id, item.id));
  }
}

/**
 * Apply one structural Table mutation and return the authoritative Table state.
 *
 * Cell values are untouched by every structural operation except a supported
 * column type change, which is validated before it is applied.
 */
export async function mutateObjectTable(objectId: string, mutation: TableDetailMutation): Promise<ObjectTableView> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await lockWritableObject(tx, objectId);
    const table = await requireTable(tx, objectId, mutation.tableId);
    const now = new Date();

    switch (mutation.action) {
      case "rename_table": {
        if (table.title === mutation.title) break;
        await tx.update(objectTables).set({ title: mutation.title, updatedAt: now }).where(eq(objectTables.id, table.id));
        await tx.insert(objectUpdates).values({
          id: randomUUID(),
          objectId,
          type: "table_renamed",
          content: `Renamed table "${table.title}" to "${mutation.title}".`,
        });
        break;
      }
      case "add_column": {
        const columns = await orderedColumns(tx, table.id);
        if (columns.length >= TABLE_LIMITS.columnsPerTable) throw new TableError("COLUMNS_LIMIT_REACHED");
        await tx.insert(objectTableColumns).values({
          id: randomUUID(),
          tableId: table.id,
          position: columns.length,
          ...toColumnValues(mutation.column),
        });
        await tx.update(objectTables).set({ updatedAt: now }).where(eq(objectTables.id, table.id));
        break;
      }
      case "update_column": {
        const columns = await orderedColumns(tx, table.id);
        const column = columns.find((item) => item.id === mutation.columnId);
        if (!column) throw new TableError("COLUMN_NOT_FOUND");
        const type = mutation.type ?? column.type;
        if (type !== column.type) await convertColumnValues(tx, column, type);
        const currency = mutation.currency !== undefined ? mutation.currency : column.currency;
        await tx.update(objectTableColumns)
          .set({
            ...(mutation.name !== undefined ? { name: mutation.name } : {}),
            type,
            ...(mutation.carryForward !== undefined ? { carryForward: mutation.carryForward } : {}),
            currency: type === "currency" ? currency ?? null : null,
            updatedAt: now,
          })
          .where(eq(objectTableColumns.id, column.id));
        await tx.update(objectTables).set({ updatedAt: now }).where(eq(objectTables.id, table.id));
        break;
      }
      case "move_column": {
        await moveInOrder(tx, table.id, mutation.columnId, mutation.direction, "column");
        await tx.update(objectTables).set({ updatedAt: now }).where(eq(objectTables.id, table.id));
        break;
      }
      case "delete_column": {
        const columns = await orderedColumns(tx, table.id);
        if (!columns.some((item) => item.id === mutation.columnId)) throw new TableError("COLUMN_NOT_FOUND");
        // Cells of this column are removed by foreign key cascade.
        await tx.delete(objectTableColumns).where(eq(objectTableColumns.id, mutation.columnId));
        await normalizePositions(tx, table.id, "column");
        await tx.update(objectTables).set({ updatedAt: now }).where(eq(objectTables.id, table.id));
        break;
      }
      case "add_row": {
        const rows = await orderedRows(tx, table.id);
        if (rows.length >= TABLE_LIMITS.rowsPerTable) throw new TableError("ROWS_LIMIT_REACHED");
        await tx.insert(objectTableRows).values({
          id: randomUUID(),
          tableId: table.id,
          position: rows.length,
          carryForward: mutation.carryForward ?? false,
        });
        await tx.update(objectTables).set({ updatedAt: now }).where(eq(objectTables.id, table.id));
        break;
      }
      case "move_row": {
        await moveInOrder(tx, table.id, mutation.rowId, mutation.direction, "row");
        await tx.update(objectTables).set({ updatedAt: now }).where(eq(objectTables.id, table.id));
        break;
      }
      case "set_row_carry_forward": {
        const rows = await orderedRows(tx, table.id);
        if (!rows.some((item) => item.id === mutation.rowId)) throw new TableError("ROW_NOT_FOUND");
        await tx.update(objectTableRows).set({ carryForward: mutation.carryForward, updatedAt: now }).where(eq(objectTableRows.id, mutation.rowId));
        await tx.update(objectTables).set({ updatedAt: now }).where(eq(objectTables.id, table.id));
        break;
      }
      case "delete_row": {
        const rows = await orderedRows(tx, table.id);
        if (!rows.some((item) => item.id === mutation.rowId)) throw new TableError("ROW_NOT_FOUND");
        // Cells of this row are removed by foreign key cascade.
        await tx.delete(objectTableRows).where(eq(objectTableRows.id, mutation.rowId));
        await normalizePositions(tx, table.id, "row");
        await tx.update(objectTables).set({ updatedAt: now }).where(eq(objectTables.id, table.id));
        break;
      }
    }
  });
  return requireTableView(objectId, mutation.tableId);
}

/**
 * Write a batch of cells for one Table. Values are canonicalised per column
 * type; an empty value clears the stored cell. Rows and columns are resolved
 * inside this Table, so an ID from another Table or another Object is rejected
 * instead of writing a cross-table cell.
 */
export async function setObjectTableCells(
  objectId: string,
  tableId: string,
  cells: { rowId: string; columnId: string; value: string }[],
): Promise<ObjectTableView> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await lockWritableObject(tx, objectId);
    const table = await requireTable(tx, objectId, tableId);
    const columnsById = new Map((await orderedColumns(tx, table.id)).map((column) => [column.id, column]));
    const rowsById = new Map((await orderedRows(tx, table.id)).map((row) => [row.id, row]));

    const seen = new Set<string>();
    const writes: { rowId: string; columnId: string; value: string | null }[] = [];
    for (const cell of cells) {
      if (!rowsById.has(cell.rowId)) throw new TableError("ROW_NOT_FOUND");
      const column = columnsById.get(cell.columnId);
      if (!column) throw new TableError("COLUMN_NOT_FOUND");
      const key = `${cell.rowId}:${cell.columnId}`;
      // The same cell twice in one payload would make the result ambiguous.
      if (seen.has(key)) throw new TableError("INVALID_CELL_VALUE");
      seen.add(key);
      const parsed = parseCellValue(column.type, cell.value);
      if (parsed.status === "invalid") throw new TableError("INVALID_CELL_VALUE");
      writes.push({ rowId: cell.rowId, columnId: cell.columnId, value: parsed.status === "ok" ? parsed.value : null });
    }

    const now = new Date();
    for (const write of writes) {
      if (write.value === null) {
        await tx.delete(objectTableCells).where(and(eq(objectTableCells.rowId, write.rowId), eq(objectTableCells.columnId, write.columnId)));
        continue;
      }
      await tx
        .insert(objectTableCells)
        .values({ id: randomUUID(), rowId: write.rowId, columnId: write.columnId, value: write.value })
        .onConflictDoUpdate({
          target: [objectTableCells.rowId, objectTableCells.columnId],
          set: { value: write.value, updatedAt: now },
        });
    }
    await tx.update(objectTables).set({ updatedAt: now }).where(eq(objectTables.id, table.id));
  });
  return requireTableView(objectId, tableId);
}

/**
 * Copy Table structure into a generated recurring occurrence, inside the
 * caller's transaction.
 *
 * Carry-forward is explicit and independent per level:
 * - a row exists again only when that row has `carryForward` true;
 * - a copied row keeps a value only when that column has `carryForward` true.
 *
 * Occurrence-specific data (a checked completion, a cost, a measured condition)
 * therefore never reaches the next occurrence unless the user opted in. Column
 * names are never inspected and no AI decision is involved. The historical
 * occurrence is only read, never modified.
 */
export async function copyTablesForRecurrence(tx: Tx, sourceObjectId: string, targetObjectId: string): Promise<void> {
  const tables = await tx
    .select()
    .from(objectTables)
    .where(eq(objectTables.objectId, sourceObjectId))
    .orderBy(asc(objectTables.position), asc(objectTables.createdAt), asc(objectTables.id));
  if (!tables.length) return;

  const tableIds = tables.map((table) => table.id);
  const columns = await tx.select().from(objectTableColumns).where(inArray(objectTableColumns.tableId, tableIds)).orderBy(...columnOrder);
  const rows = await tx
    .select()
    .from(objectTableRows)
    .where(and(inArray(objectTableRows.tableId, tableIds), eq(objectTableRows.carryForward, true)))
    .orderBy(...rowOrder);

  const tableIdMap = new Map<string, string>();
  for (const table of tables) tableIdMap.set(table.id, randomUUID());
  await insertInChunks(tables, (chunk) =>
    tx.insert(objectTables).values(
      chunk.map((table) => ({
        id: tableIdMap.get(table.id)!,
        objectId: targetObjectId,
        title: table.title,
        position: table.position,
      })),
    ),
  );

  const columnIdMap = new Map<string, string>();
  for (const column of columns) columnIdMap.set(column.id, randomUUID());
  await insertInChunks(columns, (chunk) =>
    tx.insert(objectTableColumns).values(
      chunk.map((column) => ({
        id: columnIdMap.get(column.id)!,
        tableId: tableIdMap.get(column.tableId)!,
        name: column.name,
        type: column.type,
        currency: column.currency,
        position: column.position,
        carryForward: column.carryForward,
      })),
    ),
  );

  const rowIdMap = new Map<string, string>();
  for (const row of rows) rowIdMap.set(row.id, randomUUID());
  await insertInChunks(rows, (chunk) =>
    tx.insert(objectTableRows).values(
      chunk.map((row) => ({
        id: rowIdMap.get(row.id)!,
        tableId: tableIdMap.get(row.tableId)!,
        position: row.position,
        carryForward: row.carryForward,
      })),
    ),
  );

  const carriedColumnIds = columns.filter((column) => column.carryForward).map((column) => column.id);
  if (!carriedColumnIds.length || !rows.length) return;

  const cellRows = await tx.select().from(objectTableCells).where(inArray(objectTableCells.columnId, carriedColumnIds));
  const carried = cellRows.filter((cell) => rowIdMap.has(cell.rowId));
  await insertInChunks(carried, (chunk) =>
    tx.insert(objectTableCells).values(
      chunk.map((cell) => ({
        id: randomUUID(),
        rowId: rowIdMap.get(cell.rowId)!,
        columnId: columnIdMap.get(cell.columnId)!,
        value: cell.value,
      })),
    ),
  );
}

/**
 * Insert a complete table structure (columns, rows and cells) inside the
 * caller's transaction, using the same `parseCellValue` rules as the rest of
 * Object Tables. Empty cells are stored as no cell row at all. Logs one
 * table_created event.
 */
export async function insertTableStructureInTx(
  tx: Tx,
  objectId: string,
  structure: {
    title: string;
    columns: { name: string; type: TableColumnType; currency: string | null; carryForward: boolean }[];
    rows: { carryForward: boolean; cells: string[] }[];
  },
): Promise<void> {
  if (structure.columns.length > TABLE_LIMITS.columnsPerTable) throw new TableError("COLUMNS_LIMIT_REACHED");
  if (structure.rows.length > TABLE_LIMITS.rowsPerTable) throw new TableError("ROWS_LIMIT_REACHED");

  const tableId = randomUUID();
  await tx.insert(objectTables).values({ id: tableId, objectId, title: structure.title, position: 0 });

  const columnRecords = structure.columns.map((column, position) => ({
    id: randomUUID(),
    tableId,
    position,
    name: column.name,
    type: column.type,
    currency: column.type === "currency" ? column.currency ?? null : null,
    carryForward: column.carryForward,
  }));
  await tx.insert(objectTableColumns).values(columnRecords);

  const rowRecords: { id: string; tableId: string; position: number; carryForward: boolean }[] = [];
  const cellRecords: { id: string; rowId: string; columnId: string; value: string }[] = [];
  structure.rows.forEach((row, rowPosition) => {
    const rowId = randomUUID();
    rowRecords.push({ id: rowId, tableId, position: rowPosition, carryForward: row.carryForward });
    row.cells.forEach((raw, columnIndex) => {
      const column = structure.columns[columnIndex];
      if (!column) throw new TableError("INVALID_CELL_VALUE");
      const parsed = parseCellValue(column.type, raw);
      if (parsed.status === "invalid") throw new TableError("INVALID_CELL_VALUE");
      if (parsed.status === "ok") {
        cellRecords.push({ id: randomUUID(), rowId, columnId: columnRecords[columnIndex].id, value: parsed.value });
      }
    });
  });
  await tx.insert(objectTableRows).values(rowRecords);
  if (cellRecords.length) await tx.insert(objectTableCells).values(cellRecords);

  await tx.insert(objectUpdates).values({
    id: randomUUID(),
    objectId,
    type: "table_created",
    content: `Created table "${structure.title}".`,
  });
}

