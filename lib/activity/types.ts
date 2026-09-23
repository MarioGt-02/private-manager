import { z } from "zod";

export const ACTIVITY_LIMIT = 30;
export const activityObjectIdSchema = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
export const activityResponseSchema = z.object({
  updates: z.array(z.object({
    id: z.string(),
    objectId: z.string(),
    type: z.string(),
    content: z.string(),
    createdAt: z.string().datetime({ offset: true }),
  })).max(ACTIVITY_LIMIT),
});
export type ActivityUpdate = z.infer<typeof activityResponseSchema>["updates"][number];

const labels: Record<string, string> = {
  object_archived: "Archived Object",
  object_cancelled: "Cancelled Object",
  object_restored: "Restored Object",
  legacy_import: "Imported from Kanban Tool",
  object_created: "Object created",
  status_changed: "Status changed",
  checklist_changed: "Checklist updated",
  object_edited: "Object edited",
  object_reordered: "Object reordered",
  category_changed: "Category changed",
  checklist_item_added: "Checklist item added",
  checklist_item_renamed: "Checklist item renamed",
  checklist_item_deleted: "Checklist item deleted",
  checklist_reordered: "Checklist reordered",
  ai_progress_update: "AI Progress Update",
  ai_replan: "AI Replan",
  dependency_added: "Dependency added",
  dependency_removed: "Dependency removed",
  recurrence_enabled: "Recurrence enabled",
  recurrence_updated: "Recurrence updated",
  recurrence_disabled: "Recurrence stopped",
  recurrence_generated: "Next occurrence generated",
  occurrence_note_updated: "Occurrence note updated",
};
export function activityLabel(type: string): string {
  return Object.hasOwn(labels, type) ? labels[type] : "Activity";
}
