import { z } from "zod";
import type { CreateObjectDraft } from "./types";

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

/** Editable client draft. Category IDs are user selections, never model output. */
export const createObjectDraftSchema = z.object({
  categoryId: z.string().min(1).max(200).nullable().default(null),
  title: z.string(),
  goal: z.string(),
  currentState: z.string(),
  nextAction: z.string(),
  checklist: z.array(draftChecklistItemSchema),
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
 * Compatibility for providers that ignore the structured checklist item schema
 * and return a legacy flat string array.
 */
export function normalizeLegacyChatResponse(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const response = value as Record<string, unknown>;
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

/** Compatibility for Quick Create when the provider returns a legacy flat string array checklist. */
export function normalizeLegacyDraft(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const draft = value as Record<string, unknown>;
  if (!Array.isArray(draft.checklist)) return value;
  if (!draft.checklist.every((item) => typeof item === "string")) return value;
  return {
    ...draft,
    checklist: draft.checklist.map((title) => ({ title, completed: false, children: [] })),
  };
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

export const finalizeDraftSchema = z
  .object({
    categoryId: z.string().min(1).max(200).nullable().default(null),
    title: z.string().max(120),
    goal: z.string().max(1000),
    currentState: z.string().max(1000),
    nextAction: z.string().max(500),
    checklist: z.array(finalizeChecklistItemSchema).max(20),
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
