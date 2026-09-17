import { asc } from "drizzle-orm";
import { getDb } from "./index";
import { objects, checklistItems, objectUpdates, categories } from "./schema";
import type { ExportRows } from "@/lib/portability/export";
/** All three tables from one consistent, explicitly read-only snapshot. */
export async function getExportRows(): Promise<ExportRows> {
  return getDb().transaction(async (tx) => ({
    categories: await tx.select().from(categories).orderBy(asc(categories.id)),
    objects: await tx.select().from(objects).orderBy(asc(objects.id)),
    checklistItems: await tx.select().from(checklistItems).orderBy(asc(checklistItems.objectId), asc(checklistItems.position)),
    objectUpdates: await tx.select().from(objectUpdates).orderBy(asc(objectUpdates.objectId), asc(objectUpdates.createdAt)),
  }), { isolationLevel: "repeatable read", accessMode: "read only" });
}
