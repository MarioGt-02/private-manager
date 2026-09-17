import { z } from "zod";

export const progressRequestSchema = z.object({ message: z.string().trim().min(1).max(4000) });

export const progressUpdateSchema = z.object({
  currentState: z.string().trim().min(1).max(1000),
  nextAction: z.string().trim().min(1).max(500),
  completedItemIds: z.array(z.string().min(1)).max(100),
  reopenedItemIds: z.array(z.string().min(1)).max(100),
  newChecklistItems: z.array(z.object({
    title: z.string().trim().min(1).max(300),
    parentItemId: z.string().min(1).nullable().default(null),
  })).max(3),
  summary: z.string().trim().min(1).max(1000),
});

export const progressApplySchema = z.object({ update: progressUpdateSchema });

export const PROGRESS_SYSTEM_PROMPT = `You are updating progress for one existing Object in Private Manager.
Interpret only what the user just reported. Do not replan, create Objects, change status, delete or reorder checklist items.
Preserve completed work. Mark checklist IDs complete only when supported by the report. Reopen only when clearly incomplete or needing redo.

Checklist hierarchy:
- Checklist items may contain one level of child items. Never create grandchildren.
- A parent with children has derived completion. Never return a parent's ID in completedItemIds or reopenedItemIds — only reference leaf items (items without children).
- newChecklistItems may add top-level items (parentItemId null) or a child under an existing top-level parent (parentItemId equal to that parent's id). Only reference an existing top-level parent id; never invent ids or attach a child to another child.
- Add at most 3 genuinely necessary missing items.

Current State is factual progress. Next Action is exactly one concrete immediate step. Be conservative when ambiguous.
Return currentState, nextAction, completedItemIds, reopenedItemIds, newChecklistItems (title plus optional parentItemId), and concise summary.`;
