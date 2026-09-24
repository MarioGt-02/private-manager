import { dataError } from "./data";
import { TableError, type TableErrorCode } from "@/lib/db/tables";
import { TABLE_LIMITS } from "@/lib/tables/model";

/**
 * One mapping from Object Table domain errors to the standard API error
 * envelope, shared by the three Table routes.
 */
const responses: Record<TableErrorCode, { status: number; message: string }> = {
  OBJECT_NOT_FOUND: { status: 404, message: "Object not found." },
  OBJECT_ARCHIVED: { status: 409, message: "Restore this Object before editing its tables." },
  TABLE_NOT_FOUND: { status: 404, message: "Table not found." },
  ROW_NOT_FOUND: { status: 400, message: "That row does not belong to this table." },
  COLUMN_NOT_FOUND: { status: 400, message: "That column does not belong to this table." },
  TABLES_LIMIT_REACHED: { status: 409, message: `An Object can hold up to ${TABLE_LIMITS.tablesPerObject} tables.` },
  COLUMNS_LIMIT_REACHED: { status: 409, message: `A table can hold up to ${TABLE_LIMITS.columnsPerTable} columns.` },
  ROWS_LIMIT_REACHED: { status: 409, message: `A table can hold up to ${TABLE_LIMITS.rowsPerTable} rows.` },
  INVALID_CELL_VALUE: { status: 400, message: "That value is not valid for this column type." },
  COLUMN_TYPE_INCOMPATIBLE: { status: 409, message: "Existing values cannot become this column type. Clear or fix them first." },
};

export function tableApiError(error: unknown) {
  if (error instanceof TableError) {
    const entry = responses[error.code];
    return dataError(entry.status, error.code, entry.message);
  }
  return dataError(500, "DATABASE_ERROR", "Could not save the table change.");
}
