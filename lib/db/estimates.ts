import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./index";
import { checklistItems, objects, objectUpdates } from "./schema";
import { getObject } from "./queries";
import { EstimateValidationError, estimatedMinutesSchema, validateEstimateProposal, type EstimateProposal } from "@/lib/estimates/model";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
async function editableObject(tx: Tx, objectId: string) {
  const [object] = await tx.select().from(objects).where(eq(objects.id, objectId)).for("update");
  if (!object) throw new EstimateValidationError("OBJECT_NOT_FOUND", "Object not found.");
  if (object.archivedAt || object.cancelledAt) throw new EstimateValidationError("CONFLICT", "Restore this historical Object before editing estimates.");
}
export async function updateChecklistEstimate(objectId: string, itemId: string, estimatedMinutes: number | null) {
  estimatedMinutesSchema.parse(estimatedMinutes);
  await getDb().transaction(async (tx) => {
    await editableObject(tx, objectId);
    const items = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId)).for("update");
    const item = items.find((item) => item.id === itemId);
    if (!item || items.some((child) => child.parentId === itemId)) throw new EstimateValidationError("INVALID_REQUEST", "Only existing actionable checklist leaf items can have their estimate edited.");
    if (item.estimatedMinutes === estimatedMinutes) return;
    await tx.update(checklistItems).set({ estimatedMinutes, updatedAt: new Date() }).where(eq(checklistItems.id, itemId));
    await tx.update(objects).set({ updatedAt: new Date() }).where(eq(objects.id, objectId));
    await tx.insert(objectUpdates).values({ id: randomUUID(), objectId, type: estimatedMinutes === null ? "time_estimates_cleared" : "time_estimates_applied", content: estimatedMinutes === null ? `Cleared estimate: ${item.title}.` : `Set effort estimate: ${item.title} (${estimatedMinutes} minutes).` });
  });
  return getObject(objectId);
}
export async function applyTimeEstimates(objectId: string, proposal: EstimateProposal) {
  await getDb().transaction(async (tx) => {
    await editableObject(tx, objectId);
    const items = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId)).for("update");
    validateEstimateProposal(proposal, items);
    const changed = proposal.estimates.filter((estimate) => items.find((item) => item.id === estimate.checklistItemId)!.estimatedMinutes !== estimate.estimatedMinutes);
    for (const estimate of changed) {
      await tx.update(checklistItems).set({ estimatedMinutes: estimate.estimatedMinutes, updatedAt: new Date() }).where(eq(checklistItems.id, estimate.checklistItemId));
    }
    if (changed.length) {
      await tx.update(objects).set({ updatedAt: new Date() }).where(eq(objects.id, objectId));
      await tx.insert(objectUpdates).values({ id: randomUUID(), objectId, type: "time_estimates_applied", content: `AI estimates applied to ${changed.length} checklist ${changed.length === 1 ? "item" : "items"}.` });
    }
  });
  return getObject(objectId);
}