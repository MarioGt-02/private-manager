import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./index";
import { objects, objectUpdates } from "./schema";
import type { ImportStore } from "@/lib/import/kanbantool";
/** Used only by the explicitly invoked one-time command, never by app startup. */
export const kanbanImportStore: ImportStore = {
  async existingIds(ids) {
    if (!ids.length) return new Set();
    const rows = await getDb().select({ id: objects.id }).from(objects).where(inArray(objects.id, ids));
    return new Set(rows.map((row)=>row.id));
  },
  async insert(item) {
    return getDb().transaction(async (tx) => {
      const inserted = await tx.insert(objects).values({ id: item.id, title: item.title, status: item.status, goal: item.goal, currentState: item.currentState, nextAction: item.nextAction, archivedAt: item.archivedAt, cancelledAt: item.cancelledAt, createdAt: item.createdAt, updatedAt: item.updatedAt }).onConflictDoNothing({ target: objects.id }).returning({ id: objects.id });
      if (!inserted.length) return false;
      await tx.insert(objectUpdates).values({ id: randomUUID(), objectId: item.id, type: "legacy_import", content: item.activityContent, createdAt: item.updatedAt });
      return true;
    });
  },
};
