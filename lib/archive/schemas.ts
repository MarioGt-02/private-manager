import { z } from "zod";
import { STATUSES } from "@/lib/types/object";
import { activityObjectIdSchema } from "@/lib/activity/types";
export const archiveQuerySchema = z.object({
  status: z.enum(STATUSES),
  filter: z.enum(["all", "completed", "cancelled"]).default("completed"),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});
export const lifecycleSchema = z.object({
  action: z.enum(["archive", "cancel", "restore"]),
  confirmed: z.boolean().optional(),
}).strict().refine((input) => input.action !== "cancel" || input.confirmed === true, "Cancellation requires confirmation.");
export const objectIdSchema = activityObjectIdSchema;
export type LifecycleAction = z.infer<typeof lifecycleSchema>["action"];
export type ArchiveQuery = z.infer<typeof archiveQuerySchema>;
export interface ArchivedObjectSummary {
  categoryId?: string | null;
  id: string; title: string; category: string | null; status: (typeof STATUSES)[number]; archivedAt: string; cancelledAt: string | null;
}
export interface ArchivePage { objects: ArchivedObjectSummary[]; nextOffset: number | null; }
