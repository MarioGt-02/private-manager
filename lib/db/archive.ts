import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./index";
import { objects, checklistItems, objectUpdates } from "./schema";
import { toManagedObject } from "./queries";
import { archiveQuerySchema, type ArchiveQuery, type ArchivePage, type LifecycleAction } from "@/lib/archive/schemas";

export async function getArchivedObjects(input: ArchiveQuery): Promise<ArchivePage> {
  const query = archiveQuerySchema.parse(input);
  const rows = await getDb().select({ id: objects.id, title: objects.title, category: objects.category, categoryId: objects.categoryId, status: objects.status, archivedAt: objects.archivedAt, cancelledAt: objects.cancelledAt })
    .from(objects).where(and(eq(objects.status, query.status), isNotNull(objects.archivedAt),
      query.filter === "cancelled" ? isNotNull(objects.cancelledAt) : query.filter === "completed" ? isNull(objects.cancelledAt) : undefined))
    .orderBy(desc(objects.archivedAt), desc(objects.id)).limit(31).offset(query.offset);
  return { objects: rows.slice(0, 30).map((row) => ({ ...row, archivedAt: row.archivedAt!.toISOString(), cancelledAt: row.cancelledAt?.toISOString() ?? null })), nextOffset: rows.length > 30 ? query.offset + 30 : null };
}
export class ObjectNotFoundError extends Error {}
export async function changeObjectLifecycle(objectId: string, action: LifecycleAction) {
  return getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(objects).where(eq(objects.id, objectId)).for("update");
    if (!current) throw new ObjectNotFoundError();
    const unchanged = action === "archive" ? !!current.archivedAt : action === "cancel" ? !!current.cancelledAt : !current.archivedAt && !current.cancelledAt;
    let row = current;
    if (!unchanged) {
      const now = new Date();
      const metadata = action === "restore" ? { archivedAt: null, cancelledAt: null } : action === "cancel" ? { archivedAt: now, cancelledAt: now } : { archivedAt: now };
      [row] = await tx.update(objects).set({ ...metadata, updatedAt: now }).where(eq(objects.id, objectId)).returning();
      await tx.insert(objectUpdates).values({ id: randomUUID(), objectId, type: action === "archive" ? "object_archived" : action === "cancel" ? "object_cancelled" : "object_restored", content: action === "restore" ? "Restored Object to its previous workflow column." : action === "cancel" ? "Cancelled and archived Object; workflow status preserved." : "Archived Object; workflow status preserved." });
    }
    const checklist = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId)).orderBy(asc(checklistItems.position));
    return toManagedObject(row, checklist.map(({ id, title, completed, position, parentId }) => ({ id, title, completed, position, parentId })));
  });
}
