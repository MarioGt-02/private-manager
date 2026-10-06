import { z } from "zod";
import { finalizeTableSchema } from "./schemas";
import { TABLE_LIMITS } from "@/lib/tables/model";

export const replanRequestSchema = z.object({ message: z.string().trim().min(1).max(4000) });

/** Only the explicit, single named-table command is deterministic; mixed/free-form changes remain AI reasoning. */
export function explicitTableRequestTitle(message: string): string | null {
  const match = message.trim().match(/^(?:新增表格|添加表格|新建表格|创建表格|add table|create table)\s*[:：]\s*([^\n\r,，;；。.!！?？]+)$/i);
  const title = match?.[1].trim();
  if (!title || title.length > TABLE_LIMITS.tableTitle || /(?:同时|并且|然后|并修改|并调整|并删除|and\s+(?:change|update|remove|replan))/i.test(title)) return null;
  return title;
}

const changeTypeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() : value),
  z.enum(["keep", "modify", "add"]),
);

const replanChildSchema = z.object({
  sourceItemId: z.string().nullable(),
  title: z.string().trim().min(1).max(300),
  completed: z.boolean(),
  changeType: changeTypeSchema,
});

const replanChecklistItemSchema = z.object({
  sourceItemId: z.string().nullable(),
  title: z.string().trim().min(1).max(300),
  completed: z.boolean(),
  changeType: changeTypeSchema,
  children: z.array(replanChildSchema).max(10).default([]),
});

export const replanProposalSchema = z.object({
  /** Backend-issued confirmation identity, not a model-generated value. */
  proposalId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(120).nullable(),
  goal: z.string().trim().min(1).max(1000).nullable(),
  currentState: z.string().trim().max(1000),
  reasonSummary: z.string().trim().min(1).max(1000),
  checklistMode: z.enum(["preserve", "replan"]).default("replan"),
  checklist: z.array(replanChecklistItemSchema).max(20),
  removedItemIds: z.array(z.string()).max(30),
  tablesToAdd: z.array(finalizeTableSchema).max(5).default([]),
  summary: z.string().trim().min(1).max(1000),
}).superRefine((proposal, ctx) => {
  if (proposal.checklistMode === "replan" && proposal.checklist.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.too_small, minimum: 1, type: "array", inclusive: true, path: ["checklist"], message: "A checklist is required when checklistMode is replan." });
  }
  if (proposal.checklistMode === "replan" && proposal.currentState.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["currentState"], message: "Current State is required when checklistMode is replan." });
  }
});

export const replanApplySchema = z.object({ proposal: replanProposalSchema });

export const REPLAN_PROMPT = `You are replanning one existing Object. Propose a final ordered checklist after the user's meaningful change. Preserve valid completed work and existing IDs where possible. Do not create Objects or change status. Only set title or goal when the completed outcome itself has clearly changed; otherwise return null. Removed IDs must be explicit.
If the user's request is only to add one or more structured tables, set checklistMode to "preserve", copy the existing checklist exactly, set removedItemIds to [], and put the requested tables in tablesToAdd. Never turn a table request into checklist items. If the request changes both the plan and tables, set checklistMode to "replan" and include both changes.
"新增表格：电脑部件检查表格" means ADD AN ACTUAL TABLE, not add a checklist step about using a table. Return a non-empty tablesToAdd containing that named table with useful columns such as 部件, 检查方法, 已检查 (checkbox), 检查结果, 备注. You may suggest generic components as rows, but leave inspection results blank and checkboxes false; do not invent the user's hardware, faults, completed checks, or repairs. For a table-only request return title and goal as null and copy currentState verbatim. Adding a record-keeping tool is not factual progress on the Object. This is a proposal: never claim a table has already been created. Only user confirmation can create it.
You have no web access. Use only the provided Object data.

Checklist hierarchy:
- Checklist items may contain one level of children. A top-level item may group several concrete child steps. Never create grandchildren.
- Use children only when a top-level item represents a meaningful phase/group containing multiple concrete executable steps. Keep simple plans flat.
- A parent with children has derived completion; keep a parent's completed consistent with its children in your proposal.
- changeType is exactly one of "keep", "modify", or "add" (lowercase). sourceItemId preserves an existing item for "keep" or "modify". New items use changeType "add" and sourceItemId null. Existing items you no longer want go in removedItemIds.
- Do not invent database ids.

Return title, goal, currentState, reasonSummary, checklistMode, checklist (nested: each item with sourceItemId/title/completed/changeType and an optional children array), removedItemIds, tablesToAdd (each table has title, columns and rows whose cells follow the column order), and concise summary.`;
