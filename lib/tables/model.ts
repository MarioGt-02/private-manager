/**
 * Object Tables model.
 *
 * Object Tables store structured information that belongs to ONE Object, for
 * example maintenance items, renovation materials or firmware test results.
 * The feature is deliberately generic: no domain-specific logic exists here.
 *
 * This module has no `server-only` import, so the Object Drawer reuses the same
 * limits, schemas and display formatting as the server. Cell values are stored
 * as canonical text; server-side validation interprets them by column type.
 */
import { z } from "zod";

export const TABLE_COLUMN_TYPES = ["text", "number", "date", "currency", "checkbox"] as const;
export type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number];

export const COLUMN_TYPE_LABELS: Record<TableColumnType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  currency: "Currency",
  checkbox: "Checkbox",
};

/**
 * Centralised V1 limits. They prevent accidental abuse without constraining
 * realistic personal use: the Audi maintenance acceptance example needs one
 * table, six columns and ten rows.
 */
export const TABLE_LIMITS = {
  tablesPerObject: 5,
  columnsPerTable: 20,
  rowsPerTable: 200,
  cellsPerWrite: 200,
  tableTitle: 80,
  columnName: 60,
  cellValue: 2000,
} as const;

/** Currency codes offered in the UI. Any 3-letter ISO-shaped code is accepted. */
export const CURRENCY_CODES = ["EUR", "USD", "CNY", "GBP", "JPY", "CHF"] as const;

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", CNY: "¥", GBP: "£", JPY: "¥" };

const NUMBER_PATTERN = /^[+-]?\d{1,15}(?:\.\d{1,6})?$/;
const CURRENCY_PATTERN = /^[+-]?\d{1,15}(?:\.\d{1,2})?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type CellParse =
  | { status: "empty" }
  | { status: "invalid"; message: string }
  | { status: "ok"; value: string };

/** Pure calendar check, so a date-only value can never shift across a timezone. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** Canonical currency text: exactly two decimals, computed without floating point. */
export function normalizeCurrencyAmount(value: string): string {
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = digits.split(".");
  return `${negative ? "-" : ""}${whole}.${fraction.padEnd(2, "0")}`;
}

/**
 * Canonicalise one raw cell value for a column type.
 * `empty` means "no value" and clears the stored cell.
 */
export function parseCellValue(type: TableColumnType, raw: unknown): CellParse {
  if (raw === null || raw === undefined) return { status: "empty" };
  if (typeof raw !== "string") return { status: "invalid", message: "Cell value must be text." };
  const value = raw.trim();
  if (!value) return { status: "empty" };
  if (value.length > TABLE_LIMITS.cellValue) {
    return { status: "invalid", message: `Cell value must be ${TABLE_LIMITS.cellValue} characters or fewer.` };
  }
  switch (type) {
    case "text":
      return { status: "ok", value };
    case "checkbox":
      return value === "true" || value === "false"
        ? { status: "ok", value }
        : { status: "invalid", message: "Checkbox values must be true or false." };
    case "date":
      return isCalendarDate(value)
        ? { status: "ok", value }
        : { status: "invalid", message: "Enter a real date as YYYY-MM-DD." };
    case "number":
      return NUMBER_PATTERN.test(value)
        ? { status: "ok", value: value.startsWith("+") ? value.slice(1) : value }
        : { status: "invalid", message: "Enter a plain number without units or thousands separators." };
    case "currency":
      return CURRENCY_PATTERN.test(value)
        ? { status: "ok", value: normalizeCurrencyAmount(value.startsWith("+") ? value.slice(1) : value) }
        : { status: "invalid", message: "Enter an amount with at most 2 decimals." };
  }
}

/** Presentation only: the stored amount never depends on the currency code. */
export function formatCurrencyAmount(value: string, code: string | null): string {
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const symbol = code ? CURRENCY_SYMBOLS[code] ?? `${code} ` : "";
  return `${negative ? "-" : ""}${symbol}${digits}`;
}

export function cellDisplayValue(type: TableColumnType, value: string, currency: string | null = null): string {
  if (type === "checkbox") return value === "true" ? "Yes" : "No";
  if (type === "currency") return formatCurrencyAmount(value, currency);
  return value;
}

/**
 * Carry-forward: "Should this row exist again in the next recurring occurrence?"
 * Column carry-forward: "Should this column's cell value be preserved when a
 * carry-forward row is recreated?" The two flags are independent, default to
 * false, and are never inferred from column names.
 */
export const CARRY_FORWARD_HINTS = {
  row: "Repeat this row in the next occurrence",
  column: "Keep this column's value in the next occurrence",
} as const;

export const entityIdSchema = z.string().uuid();
export const tableTitleSchema = z.string().trim().min(1).max(TABLE_LIMITS.tableTitle);
export const columnNameSchema = z.string().trim().min(1).max(TABLE_LIMITS.columnName);
export const columnTypeSchema = z.enum(TABLE_COLUMN_TYPES);
export const currencyCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code such as EUR.");

export const tableColumnInputSchema = z.object({
  name: columnNameSchema,
  type: columnTypeSchema,
  currency: currencyCodeSchema.nullable().optional(),
  carryForward: z.boolean().optional(),
}).strict();

const createTableFields = {
  title: tableTitleSchema,
  columns: z.array(tableColumnInputSchema).min(1).max(TABLE_LIMITS.columnsPerTable),
} as const;

export const tableCreateSchema = z.object(createTableFields).strict();

const moveDirectionSchema = z.union([z.literal(-1), z.literal(1)]);

/**
 * Mutations that require an existing table. They intentionally share one
 * endpoint (see the Drawer: a table is one editing surface) so the client never
 * has to guess the resulting state.
 */
export const tableDetailMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rename_table"), tableId: entityIdSchema, title: tableTitleSchema }).strict(),
  z.object({ action: z.literal("add_column"), tableId: entityIdSchema, column: tableColumnInputSchema }).strict(),
  z.object({
    action: z.literal("update_column"),
    tableId: entityIdSchema,
    columnId: entityIdSchema,
    name: columnNameSchema.optional(),
    type: columnTypeSchema.optional(),
    currency: currencyCodeSchema.nullable().optional(),
    carryForward: z.boolean().optional(),
  }).strict(),
  z.object({ action: z.literal("move_column"), tableId: entityIdSchema, columnId: entityIdSchema, direction: moveDirectionSchema }).strict(),
  z.object({ action: z.literal("delete_column"), tableId: entityIdSchema, columnId: entityIdSchema }).strict(),
  z.object({ action: z.literal("add_row"), tableId: entityIdSchema, carryForward: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("move_row"), tableId: entityIdSchema, rowId: entityIdSchema, direction: moveDirectionSchema }).strict(),
  z.object({ action: z.literal("set_row_carry_forward"), tableId: entityIdSchema, rowId: entityIdSchema, carryForward: z.boolean() }).strict(),
  z.object({ action: z.literal("delete_row"), tableId: entityIdSchema, rowId: entityIdSchema }).strict(),
]);

export type TableDetailMutation = z.infer<typeof tableDetailMutationSchema>;

export const tableCellsWriteSchema = z.object({
  cells: z.array(
    z.object({ rowId: entityIdSchema, columnId: entityIdSchema, value: z.string().max(TABLE_LIMITS.cellValue) }).strict(),
  ).min(1).max(TABLE_LIMITS.cellsPerWrite),
}).strict();

export interface TableColumnView {
  id: string;
  name: string;
  type: TableColumnType;
  currency: string | null;
  position: number;
  carryForward: boolean;
}

export interface TableRowView {
  id: string;
  position: number;
  carryForward: boolean;
  /** columnId -> canonical stored value. Absent means "no value". */
  cells: Record<string, string>;
}

export interface ObjectTableView {
  id: string;
  objectId: string;
  title: string;
  position: number;
  columns: TableColumnView[];
  rows: TableRowView[];
}
