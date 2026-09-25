import { z } from "zod";
import { columnTypeSchema, currencyCodeSchema, parseCellValue, TABLE_LIMITS } from "@/lib/tables/model";
import type { RecurrenceFormInput } from "@/lib/types/object";
import type { CreateObjectDraft, DraftTable } from "./types";

const aiMessageRoleSchema = z.enum(["user", "assistant"]);

export const aiMessageSchema = z.object({
  role: aiMessageRoleSchema,
  content: z.string().min(1).max(4000),
});

/** Child draft item — one level only, never has its own children. */
export const draftChecklistChildSchema = z.object({
  title: z.string(),
  completed: z.boolean(),
});

/** Top-level draft item carrying at most one level of children. */
export const draftChecklistItemSchema = z.object({
  title: z.string(),
  completed: z.boolean(),
  children: z.array(draftChecklistChildSchema).default([]),
});

/**
 * Draft-layer recurrence. Every field is optional so the AI may hold partially
 * known recurrence (e.g. yearly/interval while basis or date is unresolved)
 * during clarification without discarding what it already knows.
 */
export const draftRecurrenceSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  interval: z.number().int().min(1).max(100).optional(),
  basis: z.enum(["scheduled_date", "completion_date"]).optional(),
  nextDate: z.string().nullable().optional(),
});

/** Draft table column (structure only; strict limits are enforced at finalize). */
export const draftTableColumnSchema = z.object({
  name: z.string(),
  type: columnTypeSchema,
  currency: z.string().nullable().optional(),
  carryForward: z.boolean().optional(),
});

/** Draft table row; `cells[i]` corresponds to `columns[i]`, "" (or null from AI) is empty. */
export const draftTableRowSchema = z.object({
  carryForward: z.boolean().optional(),
  cells: z.array(z.string().nullable()),
});

/** A single draft table. V1 supports at most one per Object. */
export const draftTableSchema = z.object({
  title: z.string(),
  columns: z.array(draftTableColumnSchema),
  rows: z.array(draftTableRowSchema),
});

/** Editable client draft. Category IDs are user selections, never model output. */
export const createObjectDraftSchema = z.object({
  categoryId: z.string().min(1).max(200).nullable().default(null),
  title: z.string(),
  goal: z.string(),
  currentState: z.string(),
  nextAction: z.string(),
  checklist: z.array(draftChecklistItemSchema),
  recurrence: draftRecurrenceSchema.nullable().default(null),
  table: draftTableSchema.nullable().default(null),
});

export const chatRequestSchema = z
  .object({
    messages: z.array(aiMessageSchema).min(1).max(30),
    currentDraft: createObjectDraftSchema.nullable().optional(),
  })
  .refine(
    (value) => {
      const total = value.messages.reduce(
        (sum, message) => sum + message.content.length,
        0,
      );
      return total <= 20000;
    },
    { message: "Conversation input is too large." },
  );

/** Model-output draft shape: nested checklist with title + children (no IDs/positions). */
const chatDraftChildSchema = z.object({ title: z.string(), completed: z.boolean().default(false) });
const chatDraftChecklistItemSchema = z.object({
  title: z.string(),
  completed: z.boolean().default(false),
  children: z.array(chatDraftChildSchema).default([]),
});

export const chatResponseSchema = z.object({
  message: z.string(),
  phase: z.enum(["clarifying", "proposal"]),
  draft: z
    .object({
      title: z.string(),
      goal: z.string(),
      currentState: z.string(),
      nextAction: z.string(),
      suggestedCategoryName: z.string().nullable().default(null),
      checklist: z.array(chatDraftChecklistItemSchema),
      recurrence: draftRecurrenceSchema.nullable().default(null),
      table: draftTableSchema.nullable().default(null),
    })
    .nullable(),
});

export const quickCreateRequestSchema = z.object({
  text: z.string().trim().min(1).max(20000),
});

export const quickCreateResponseSchema = z.object({
  title: z.string(),
  goal: z.string(),
  currentState: z.string(),
  nextAction: z.string(),
  suggestedCategoryName: z.string().nullable().default(null),
  checklist: z.array(chatDraftChecklistItemSchema),
});

/**
 * Compatibility for providers that ignore the structured-output schema and
 * return legacy shapes:
 *   1. A flat draft (title/goal/currentState/nextAction/checklist) without the
 *      message/phase/draft wrapper — treated as a proposal.
 *   2. A string-array checklist instead of object items.
 */
export function normalizeLegacyChatResponse(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const response = value as Record<string, unknown>;

  const flatDraft = extractFlatDraft(response);
  if (flatDraft) {
    return {
      message: "Here is the Object I drafted. Review and confirm to create it.",
      phase: "proposal",
      draft: flatDraft,
    };
  }

  const draft = response.draft;
  if (typeof draft !== "object" || draft === null) return value;
  const draftRecord = draft as Record<string, unknown>;
  if (!Array.isArray(draftRecord.checklist)) return value;
  if (!draftRecord.checklist.every((item) => typeof item === "string")) return value;

  return {
    ...response,
    draft: {
      ...draftRecord,
      checklist: draftRecord.checklist.map((title) => ({ title, completed: false, children: [] })),
    },
  };
}

/** Wrap a flat draft (no message/phase/draft wrapper) into the chat shape. */
function extractFlatDraft(response: Record<string, unknown>): Record<string, unknown> | null {
  if (response.message !== undefined || response.phase !== undefined || response.draft !== undefined) {
    return null;
  }
  if (
    typeof response.title !== "string" ||
    typeof response.goal !== "string" ||
    typeof response.currentState !== "string" ||
    typeof response.nextAction !== "string" ||
    !Array.isArray(response.checklist)
  ) {
    return null;
  }
  return {
    title: response.title,
    goal: response.goal,
    currentState: response.currentState,
    nextAction: response.nextAction,
    suggestedCategoryName: response.suggestedCategoryName ?? null,
    checklist: response.checklist.map((item) =>
      typeof item === "string" ? { title: item, completed: false, children: [] } : item,
    ),
    recurrence: response.recurrence ?? null,
    table: response.table ?? null,
  };
}

/** Compatibility for Quick Create when the provider returns legacy string checklist items or string children. */
export function normalizeLegacyDraft(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const draft = value as Record<string, unknown>;
  if (!Array.isArray(draft.checklist)) return value;

  const checklist = draft.checklist.map((item) => {
    if (typeof item === "string") return { title: item, completed: false, children: [] };
    if (typeof item === "object" && item !== null) {
      const record = item as Record<string, unknown>;
      const children = Array.isArray(record.children)
        ? record.children.map((child) => (typeof child === "string" ? { title: child, completed: false } : child))
        : (record.children ?? []);
      return { ...record, children };
    }
    return item;
  });

  return { ...draft, checklist };
}

const finalizeChildSchema = z.object({
  title: z.string().max(300),
  completed: z.boolean(),
});

const finalizeChecklistItemSchema = z.object({
  title: z.string().max(300),
  completed: z.boolean(),
  children: z.array(finalizeChildSchema).max(10).default([]),
});

/** Complete, valid recurrence for persistence. */
export const finalizeRecurrenceSchema = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().min(1).max(100),
    basis: z.enum(["scheduled_date", "completion_date"]),
    nextDate: z.string().trim().nullable().optional(),
  })
  .superRefine((recurrence, ctx) => {
    if (recurrence.basis === "scheduled_date") {
      if (!recurrence.nextDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nextDate"], message: "A scheduled date is required for scheduled-date recurrence." });
      } else if (parseCellValue("date", recurrence.nextDate).status === "invalid") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nextDate"], message: "Enter a real date as YYYY-MM-DD." });
      }
    }
  });

const finalizeTableColumnSchema = z.object({
  name: z.string().trim().min(1).max(TABLE_LIMITS.columnName),
  type: columnTypeSchema,
  currency: currencyCodeSchema.nullable(),
  carryForward: z.boolean(),
});

const finalizeTableRowSchema = z.object({
  carryForward: z.boolean(),
  cells: z.array(z.string().max(TABLE_LIMITS.cellValue)),
});

/** Strict, authoritative table validation: limits, alignment and cell semantics. */
export const finalizeTableSchema = z
  .object({
    title: z.string().trim().min(1).max(TABLE_LIMITS.tableTitle),
    columns: z.array(finalizeTableColumnSchema).min(1).max(TABLE_LIMITS.columnsPerTable),
    rows: z.array(finalizeTableRowSchema).max(TABLE_LIMITS.rowsPerTable),
  })
  .superRefine((table, ctx) => {
    table.rows.forEach((row, rowIndex) => {
      if (row.cells.length !== table.columns.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rows", rowIndex, "cells"], message: "Cell count must match column count." });
        return;
      }
      row.cells.forEach((cell, columnIndex) => {
        const parsed = parseCellValue(table.columns[columnIndex].type, cell);
        if (parsed.status === "invalid") {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rows", rowIndex, "cells", columnIndex], message: parsed.message });
        }
      });
    });
  });

export const finalizeDraftSchema = z
  .object({
    categoryId: z.string().min(1).max(200).nullable().default(null),
    title: z.string().max(120),
    goal: z.string().max(1000),
    currentState: z.string().max(1000),
    nextAction: z.string().max(500),
    checklist: z.array(finalizeChecklistItemSchema).max(20),
    recurrence: finalizeRecurrenceSchema.nullable().default(null),
    table: finalizeTableSchema.nullable().default(null),
  })
  .superRefine((draft, ctx) => {
    const total = draft.checklist.reduce(
      (sum, item) => sum + 1 + item.children.length,
      0,
    );
    if (total > 50) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checklist"],
        message: "Total checklist rows exceed 50.",
      });
    }
  });

export const finalizeRequestSchema = z.object({
  draft: finalizeDraftSchema,
});

export interface NormalizedChecklistChild {
  title: string;
  completed: boolean;
}

export interface NormalizedChecklistItem {
  title: string;
  completed: boolean;
  children: NormalizedChecklistChild[];
}

export interface NormalizedDraft {
  title: string;
  goal: string;
  currentState: string;
  nextAction: string;
  checklist: NormalizedChecklistItem[];
}

/**
 * Trim strings, drop accidental empty checklist items/children, and keep at
 * most one child level. Returns null when the result is not a usable Object.
 */
export function normalizeDraft(draft: CreateObjectDraft): NormalizedDraft | null {
  const title = draft.title.trim();
  const goal = draft.goal.trim();
  const currentState = draft.currentState.trim();
  const nextAction = draft.nextAction.trim();

  const checklist: NormalizedChecklistItem[] = [];
  for (const item of draft.checklist) {
    const parentTitle = item.title.trim();
    if (!parentTitle) continue;
    const children = (item.children ?? [])
      .map((child) => ({ title: child.title.trim(), completed: child.completed }))
      .filter((child) => child.title.length > 0);
    checklist.push({ title: parentTitle, completed: item.completed, children });
  }

  if (!title || !goal || !currentState || !nextAction || checklist.length === 0) {
    return null;
  }

  return { title, goal, currentState, nextAction, checklist };
}

/** Trim and canonicalise an AI/client table draft: null cells become "", flags become booleans. */
export function normalizeDraftTable(table: z.infer<typeof draftTableSchema>): DraftTable {
  return {
    title: table.title.trim(),
    columns: table.columns.map((column) => ({
      name: column.name.trim(),
      type: column.type,
      currency: column.currency ?? null,
      carryForward: !!column.carryForward,
    })),
    rows: table.rows.map((row) => ({
      carryForward: !!row.carryForward,
      cells: row.cells.map((cell) => (cell ?? "").trim()),
    })),
  };
}

/** Convert an already-validated finalize recurrence into a RecurrenceFormInput. */
export function toRecurrenceFormInput(recurrence: z.infer<typeof finalizeRecurrenceSchema>): RecurrenceFormInput {
  return { frequency: recurrence.frequency, interval: recurrence.interval, basis: recurrence.basis, nextDate: recurrence.nextDate ?? null };
}
