import { z } from "zod";
import type { ChecklistItem } from "@/lib/types/object";
import { ESTIMATE_MINUTES_MAX, getActionableLeaves } from "./time";

export const estimatedMinutesSchema = z.number().int().min(1).max(ESTIMATE_MINUTES_MAX).nullable();
export const estimateModeSchema = z.enum(["missing", "all"]);
export const estimateRequestSchema = z.object({ mode: estimateModeSchema.default("missing") }).strict();
export const estimateOutputSchema = z.object({
  estimates: z.array(z.object({ checklistItemId: z.string().min(1), estimatedMinutes: estimatedMinutesSchema }).strict()).max(500),
  warning: z.string().max(1000).nullable(),
}).strict();
export const estimateSnapshotSchema = z.array(z.object({
  id: z.string().min(1), parentId: z.string().nullable(), title: z.string(), completed: z.boolean(),
  position: z.number().int(), estimatedMinutes: estimatedMinutesSchema,
}).strict()).max(500);
export const estimateProposalSchema = estimateOutputSchema.extend({ mode: estimateModeSchema, snapshot: estimateSnapshotSchema }).strict();
export const estimateApplySchema = z.object({ proposal: estimateProposalSchema }).strict();
export const manualEstimateSchema = z.object({ itemId: z.string().min(1), estimatedMinutes: estimatedMinutesSchema }).strict();
export type EstimateMode = z.infer<typeof estimateModeSchema>;
export type EstimateOutput = z.infer<typeof estimateOutputSchema>;
export type EstimateProposal = z.infer<typeof estimateProposalSchema>;

export class EstimateValidationError extends Error {
  constructor(public readonly code: "OBJECT_NOT_FOUND" | "CONFLICT" | "UPDATE_CONFLICT" | "INVALID_REQUEST", message: string) {
    super(message);
    this.name = "EstimateValidationError";
  }
}
export function estimateSnapshot(items: ChecklistItem[]) {
  return items.map(({ id, parentId, title, completed, position, estimatedMinutes }) => ({
    id, parentId, title, completed, position, estimatedMinutes: estimatedMinutes ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id));
}
export function getEstimateTargets(items: ChecklistItem[], mode: EstimateMode) {
  return getActionableLeaves(items).filter((item) => mode === "all" || item.estimatedMinutes == null);
}
export function validateEstimateOutput(output: EstimateOutput, items: ChecklistItem[], mode: EstimateMode) {
  estimateOutputSchema.parse({ estimates: output.estimates, warning: output.warning });
  const targets = new Set(getEstimateTargets(items, mode).map((item) => item.id));
  const ids = output.estimates.map((estimate) => estimate.checklistItemId);
  if (new Set(ids).size !== ids.length) throw new EstimateValidationError("INVALID_REQUEST", "The estimate proposal contains duplicate checklist IDs.");
  if (ids.some((id) => !targets.has(id))) throw new EstimateValidationError("UPDATE_CONFLICT", "An estimate references an unknown, non-leaf, or already estimated checklist item. Generate a fresh proposal.");
}
export function validateEstimateProposal(proposal: EstimateProposal, items: ChecklistItem[]) {
  estimateProposalSchema.parse(proposal);
  if (JSON.stringify(estimateSnapshot(proposal.snapshot)) !== JSON.stringify(estimateSnapshot(items))) {
    throw new EstimateValidationError("UPDATE_CONFLICT", "The checklist or its estimates changed after this preview. Generate a fresh estimate proposal.");
  }
  validateEstimateOutput(proposal, items, proposal.mode);
}

export const ESTIMATE_PROMPT = `Estimate approximate ACTIVE HUMAN WORK / ATTENTION effort for the existing actionable checklist leaf items in ONE Object.
Effort is not elapsed waiting time, delivery time, response time, calendar duration, deadline, or recurrence interval. Ordering a part may need 15 minutes even if delivery takes 5 days. A passive wait should normally have estimatedMinutes null; only estimate actual review/responding effort if described.
Consider complexity, setup, implementation, verification/testing and the scope in the goal. Avoid arbitrary optimism. Estimates are approximations, not guarantees.
Only return estimates for targetChecklistItemIds. Copy checklistItemId character-for-character from the supplied IDs, never use titles to identify items and never invent IDs. Never estimate parents with children. In missing mode never replace existing estimates. Include completed leaves when targeted.
Do not add, delete, rename, complete or reorder items, or change any Object field. A short warning may describe missing scope (such as testing), but do not add steps. Use null when no active effort is appropriate. Otherwise use integer minutes from 1 to 525600.
Return only estimates (checklistItemId, estimatedMinutes) and warning (short text or null).`;