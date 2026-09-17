import {
  AnyPgColumn,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
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
  },
  (table) => [
    index("objects_status_idx").on(table.status),
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
