import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "./index";
import { objects, objectUpdates } from "./schema";
import { ACTIVITY_LIMIT, activityObjectIdSchema, activityResponseSchema } from "@/lib/activity/types";

/** Dedicated read-only Activity UI query; no checklist or AI context is loaded. */
export async function getObjectUpdates(objectId: string, limit = ACTIVITY_LIMIT) {
  const id = activityObjectIdSchema.parse(objectId);
  const count = Number.isInteger(limit) ? Math.min(ACTIVITY_LIMIT, Math.max(1, limit)) : ACTIVITY_LIMIT;
  const db = getDb();
  const [object] = await db.select({ id: objects.id }).from(objects).where(eq(objects.id, id)).limit(1);
  if (!object) return null;
  const rows = await db.select({
    id: objectUpdates.id,
    objectId: objectUpdates.objectId,
    type: objectUpdates.type,
    content: objectUpdates.content,
    createdAt: objectUpdates.createdAt,
  }).from(objectUpdates)
    .where(eq(objectUpdates.objectId, id))
    .orderBy(desc(objectUpdates.createdAt), desc(objectUpdates.id))
    .limit(count);
  return activityResponseSchema.parse({
    updates: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
  }).updates;
}
