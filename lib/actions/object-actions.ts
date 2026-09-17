"use server";

import { requireAuth } from "@/lib/auth/require-auth";
import { createObject } from "@/lib/db/queries";
import { manualCreateObjectSchema } from "@/lib/validation/manual-edit";

import { createChecklistItem, deleteChecklistItem, renameChecklistItem, reorderChecklistItems, reorderObjects, updateChecklistItem, updateObjectField, updateObjectStatus } from "@/lib/db/queries";
import { checklistItemMutationSchema, checklistReorderSchema, checklistTitleLimit, checklistTitleSchema, objectFieldLimits, objectReorderSchema, updateObjectFieldsSchema } from "@/lib/validation/manual-edit";
import { isStatus } from "@/lib/types/object";
import type { ChecklistItem } from "@/lib/types/object";

export async function createManualObjectAction(input: unknown) {
  await requireAuth();
  const parsed = manualCreateObjectSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid Object details.");
  return createObject({ ...parsed.data, activityContent: "Object created manually." });
}

/**
 * Persist a Kanban drag: moving an Object between columns changes its status.
 * Deterministic operation — no AI involved.
 */
export async function moveObjectToStatus(
  objectId: string,
  status: string,
): Promise<void> {
  await requireAuth();
  if (!isStatus(status)) {
    throw new Error(`Invalid object status: ${status}`);
  }
  await updateObjectStatus(objectId, status);
}

export async function reorderObjectsAction(input: unknown): Promise<void> {
  await requireAuth();
  const parsed = objectReorderSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid Object ordering.");
  await reorderObjects(parsed.data.objectId, parsed.data.targetStatus, parsed.data.orderedObjectIds);
}

/**
 * Persist a manual checklist check/uncheck. Deterministic operation — no AI
 * involved.
 */
export async function setChecklistItemCompleted(
  itemId: string,
  completed: boolean,
): Promise<ChecklistItem> {
  await requireAuth();
  return updateChecklistItem(itemId, completed);
}

export async function updateObjectFieldsAction(input: unknown) {
  await requireAuth();
  const parsed = updateObjectFieldsSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid object field update.");
  const value = objectFieldLimits[parsed.data.field].parse(parsed.data.value);
  return updateObjectField(parsed.data.objectId, parsed.data.field, value);
}

export async function addChecklistItemAction(objectId: string, title: string, parentId?: string | null) {
  await requireAuth();
  const parsed = checklistTitleLimit.safeParse(title);
  if (!parsed.success) throw new Error("Invalid checklist title.");
  return createChecklistItem(objectId, parsed.data, parentId == null ? null : parentId);
}

export async function renameChecklistItemAction(input: unknown) {
  await requireAuth();
  const parsed = checklistTitleSchema.safeParse(input);
  if (!parsed.success || !parsed.data.itemId) throw new Error("Invalid checklist rename.");
  return renameChecklistItem(parsed.data.itemId, parsed.data.objectId, checklistTitleLimit.parse(parsed.data.title));
}

export async function deleteChecklistItemAction(input: unknown) {
  await requireAuth();
  const parsed = checklistItemMutationSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid checklist deletion.");
  return deleteChecklistItem(parsed.data.itemId, parsed.data.objectId);
}

export async function reorderChecklistItemsAction(input: unknown) {
  await requireAuth();
  const parsed = checklistReorderSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid checklist ordering.");
  return reorderChecklistItems(parsed.data.objectId, parsed.data.parentId ?? null, parsed.data.orderedItemIds);
}
