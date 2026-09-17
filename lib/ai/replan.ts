import { z } from "zod";

export const replanRequestSchema = z.object({ message: z.string().trim().min(1).max(4000) });

const replanChildSchema = z.object({
  sourceItemId: z.string().nullable(),
  title: z.string().trim().min(1).max(300),
  completed: z.boolean(),
  changeType: z.enum(["keep", "modify", "add"]),
});

const replanChecklistItemSchema = z.object({
  sourceItemId: z.string().nullable(),
  title: z.string().trim().min(1).max(300),
  completed: z.boolean(),
  changeType: z.enum(["keep", "modify", "add"]),
  children: z.array(replanChildSchema).max(10).default([]),
});

export const replanProposalSchema = z.object({
  title: z.string().trim().min(1).max(120).nullable(),
  goal: z.string().trim().min(1).max(1000).nullable(),
  currentState: z.string().trim().min(1).max(1000),
  reasonSummary: z.string().trim().min(1).max(1000),
  checklist: z.array(replanChecklistItemSchema).min(1).max(20),
  removedItemIds: z.array(z.string()).max(30),
  summary: z.string().trim().min(1).max(1000),
});

export const replanApplySchema = z.object({ proposal: replanProposalSchema });

export const REPLAN_PROMPT = `You are replanning one existing Object. Propose a final ordered checklist after the user's meaningful change. Preserve valid completed work and existing IDs where possible. Do not create Objects or change status. Only set title or goal when the completed outcome itself has clearly changed; otherwise return null. Removed IDs must be explicit.

Checklist hierarchy:
- Checklist items may contain one level of children. A top-level item may group several concrete child steps. Never create grandchildren.
- Use children only when a top-level item represents a meaningful phase/group containing multiple concrete executable steps. Keep simple plans flat.
- A parent with children has derived completion; keep a parent's completed consistent with its children in your proposal.
- sourceItemId preserves an existing item (KEEP or MODIFY). New items (ADD) use sourceItemId null. Existing items you no longer want go in removedItemIds.
- Do not invent database ids.

Return title, goal, currentState, reasonSummary, checklist (nested: each item with sourceItemId/title/completed/changeType and an optional children array), removedItemIds, and concise summary.`;
