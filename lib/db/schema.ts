import {
  AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { COLOR_TOKENS } from "@/lib/categories/model";

export const categoryColorEnum = pgEnum("category_color", COLOR_TOKENS);
export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: categoryColorEnum("color").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("categories_name_unique").on(sql`lower(btrim(${table.name}))`)]);

/**
 * The Object lifecycle status. Kept as a PostgreSQL enum so arbitrary strings
 * cannot be stored in the `objects.status` column.
 */
export const objectStatusEnum = pgEnum("object_status", [
  "idea",
  "ready",
  "doing",
  "waiting",
  "done",
]);

export type ObjectStatus = (typeof objectStatusEnum.enumValues)[number];

export const recurrenceFrequencyEnum = pgEnum("recurrence_frequency", [
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

export const recurrenceBasisEnum = pgEnum("recurrence_basis", [
  "scheduled_date",
  "completion_date",
]);

/**
 * One complete thing, outcome, or goal. NOT a task.
 */
export const objects = pgTable(
  "objects",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    category: text("category"),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "restrict" }),
    status: objectStatusEnum("status").notNull().default("idea"),
    goal: text("goal").notNull().default(""),
    currentState: text("current_state").notNull().default(""),
    nextAction: text("next_action").notNull().default(""),
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    recurrenceSeriesId: text("recurrence_series_id"),
    recurrenceFrequency: recurrenceFrequencyEnum("recurrence_frequency"),
    recurrenceInterval: integer("recurrence_interval").notNull().default(1),
    recurrenceBasis: recurrenceBasisEnum("recurrence_basis"),
    recurrenceNextDate: date("recurrence_next_date", { mode: "string" }),
    previousOccurrenceId: text("previous_occurrence_id").references((): AnyPgColumn => objects.id, { onDelete: "set null" }),
    nextOccurrenceId: text("next_occurrence_id").references((): AnyPgColumn => objects.id, { onDelete: "set null" }),
    occurrenceNote: text("occurrence_note"),
  },
  (table) => [
    index("objects_status_idx").on(table.status),
    index("objects_recurrence_series_id_idx").on(table.recurrenceSeriesId),
    index("objects_status_archived_at_idx").on(table.status, table.archivedAt),
    index("objects_status_position_idx").on(table.status, table.position),
  ],
);

/**
 * The internal execution sequence belonging to a single Object.
 */
export const checklistItems = pgTable(
  "checklist_items",
  {
    id: text("id").primaryKey(),
    objectId: text("object_id")
      .notNull()
      .references(() => objects.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnyPgColumn => checklistItems.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    completed: boolean("completed").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("checklist_items_object_id_idx").on(table.objectId),
    index("checklist_items_parent_id_idx").on(table.parentId),
  ],
);

/**
 * Append-only activity history. This becomes the Activity Log / AI history
 * foundation in later phases.
 */
export const objectUpdates = pgTable(
  "object_updates",
  {
    id: text("id").primaryKey(),
    objectId: text("object_id")
      .notNull()
      .references(() => objects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("object_updates_object_id_idx").on(table.objectId)],
);

/**
 * Structured information belonging to one Object: maintenance items, materials,
 * firmware results and similar records. Objects and Tables are 1:N so a future
 * multi-table experience needs no schema change.
 *
 * `carryForward` on a row means "this row exists again in the next recurring
 * occurrence"; on a column it means "this column's value is preserved for a
 * carried-forward row". The flags are independent, default to false, and are
 * never inferred from names.
 */
export const objectTables = pgTable(
  "object_tables",
  {
    id: text("id").primaryKey(),
    objectId: text("object_id")
      .notNull()
      .references(() => objects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("object_tables_object_id_idx").on(table.objectId, table.position)],
);

export const objectTableColumnTypeEnum = pgEnum("object_table_column_type", [
  "text",
  "number",
  "date",
  "currency",
  "checkbox",
]);

export const objectTableColumns = pgTable(
  "object_table_columns",
  {
    id: text("id").primaryKey(),
    tableId: text("table_id")
      .notNull()
      .references(() => objectTables.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: objectTableColumnTypeEnum("type").notNull(),
    /** Presentation only; never used for conversion or arithmetic. */
    currency: text("currency"),
    position: integer("position").notNull().default(0),
    carryForward: boolean("carry_forward").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("object_table_columns_table_id_idx").on(table.tableId, table.position)],
);

export const objectTableRows = pgTable(
  "object_table_rows",
  {
    id: text("id").primaryKey(),
    tableId: text("table_id")
      .notNull()
      .references(() => objectTables.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    carryForward: boolean("carry_forward").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("object_table_rows_table_id_idx").on(table.tableId, table.position)],
);

/**
 * One cell is a (row, column) pair holding a canonical text value. An empty
 * value is stored as no row at all, so "no value" and "empty value" can never
 * diverge. Deleting a row or a column removes the affected cells by cascade.
 */
export const objectTableCells = pgTable(
  "object_table_cells",
  {
    id: text("id").primaryKey(),
    rowId: text("row_id")
      .notNull()
      .references(() => objectTableRows.id, { onDelete: "cascade" }),
    columnId: text("column_id")
      .notNull()
      .references(() => objectTableColumns.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("object_table_cells_row_column_idx").on(table.rowId, table.columnId),
    index("object_table_cells_column_id_idx").on(table.columnId),
  ],
);

/**
 * A single canonical dependency relationship: `objectId` depends on
 * `dependsOnObjectId`. The inverse ("Blocking") direction is derived from this
 * same table, never stored separately. The composite primary key enforces
 * uniqueness (no duplicate A -> B) and doubles as the forward index.
 */
export const objectDependencies = pgTable(
  "object_dependencies",
  {
    objectId: text("object_id")
      .notNull()
      .references(() => objects.id, { onDelete: "cascade" }),
    dependsOnObjectId: text("depends_on_object_id")
      .notNull()
      .references(() => objects.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.objectId, table.dependsOnObjectId] }),
    index("object_dependencies_depends_on_idx").on(table.dependsOnObjectId),
  ],
);
