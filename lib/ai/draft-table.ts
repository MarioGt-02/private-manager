import { parseCellValue, type TableColumnType } from "@/lib/tables/model";
import type { DraftTable, DraftTableColumn } from "./types";

/**
 * Draft table structural helpers.
 *
 * The draft stores each row as `cells: string[]` aligned to `columns`, so every
 * structural mutation must move/insert/remove the matching cell in EVERY row.
 * These helpers are the only code that changes `cells`, which keeps column
 * metadata and row cell values from ever becoming misaligned.
 */

function moveCell(cells: string[], from: number, to: number): string[] {
  const next = [...cells];
  const [value] = next.splice(from, 1);
  next.splice(to, 0, value);
  return next;
}

export function moveColumn(table: DraftTable, from: number, to: number): DraftTable {
  if (from === to || from < 0 || to < 0 || from >= table.columns.length || to >= table.columns.length) return table;
  const columns = [...table.columns];
  const [column] = columns.splice(from, 1);
  columns.splice(to, 0, column);
  return { ...table, columns, rows: table.rows.map((row) => ({ ...row, cells: moveCell(row.cells, from, to) })) };
}

export function deleteColumn(table: DraftTable, index: number): DraftTable {
  if (index < 0 || index >= table.columns.length) return table;
  return {
    ...table,
    columns: table.columns.filter((_, i) => i !== index),
    rows: table.rows.map((row) => ({ ...row, cells: row.cells.filter((_, i) => i !== index) })),
  };
}

export function addColumn(table: DraftTable, column: DraftTableColumn, at: number = table.columns.length): DraftTable {
  const index = Math.max(0, Math.min(at, table.columns.length));
  const columns = [...table.columns];
  columns.splice(index, 0, column);
  return {
    ...table,
    columns,
    rows: table.rows.map((row) => {
      const cells = [...row.cells];
      cells.splice(index, 0, "");
      return { ...row, cells };
    }),
  };
}

/**
 * Change a column's type without guessing, stripping or fabricating values.
 * Every existing cell must already parse for the new type; otherwise the change
 * is refused with a message and the original type and values are kept.
 */
export function changeColumnType(table: DraftTable, index: number, nextType: TableColumnType, nextCurrency: string | null = null):
  | { ok: true; table: DraftTable }
  | { ok: false; message: string } {
  const column = table.columns[index];
  if (!column || column.type === nextType) return { ok: true, table };

  const converted: string[] = [];
  for (const row of table.rows) {
    const raw = row.cells[index] ?? "";
    const parsed = parseCellValue(nextType, raw);
    if (parsed.status === "invalid") return { ok: false, message: parsed.message };
    converted.push(parsed.status === "ok" ? parsed.value : "");
  }

  const columns = table.columns.map((c, i) =>
    i === index ? { ...c, type: nextType, currency: nextType === "currency" ? nextCurrency ?? c.currency : null } : c,
  );
  const rows = table.rows.map((row, i) => {
    const cells = [...row.cells];
    cells[index] = converted[i];
    return { ...row, cells };
  });
  return { ok: true, table: { ...table, columns, rows } };
}
