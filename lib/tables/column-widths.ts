import type { TableColumnType } from "./model";

export const MIN_TABLE_COLUMN_WIDTH = 56;
export const MAX_TABLE_COLUMN_WIDTH = 1600;
export const TABLE_ROW_ACTIONS_WIDTH = 88;
export const DEFAULT_TABLE_COLUMN_WIDTHS: Record<TableColumnType, number> = { text: 144, number: 96, date: 128, currency: 112, checkbox: 64 };

export function clampTableColumnWidth(value: number): number {
  return Math.min(MAX_TABLE_COLUMN_WIDTH, Math.max(MIN_TABLE_COLUMN_WIDTH, Math.round(value)));
}

/** Ignore malformed/stale storage, and never associate widths with a column's position or title. */
export function parseTableColumnWidths(raw: string | null, columnIds: string[]): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const widths: Record<string, number> = {};
    for (const id of columnIds) {
      const value = Object.prototype.hasOwnProperty.call(parsed, id) ? (parsed as Record<string, unknown>)[id] : undefined;
      if (typeof value === "number" && Number.isFinite(value)) widths[id] = clampTableColumnWidth(value);
    }
    return widths;
  } catch { return {}; }
}