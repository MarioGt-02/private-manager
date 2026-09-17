import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "./index";
import { objects, objectUpdates } from "./schema";
import { categoryEntriesSchema, type CategoryEntry } from "@/lib/import/category-backfill";
import { legacyObjectId } from "@/lib/import/kanbantool";
/** Presentation-only backfill: never updates content, updatedAt or Activity.
 * Both deterministic identity and legacy_import provenance are required.
 */
export async function backfillObjectCategories(input: CategoryEntry[], dryRun = true) {
  const entries = categoryEntriesSchema.parse(input);
  if (new Set(entries.map((item)=>item.id)).size !== entries.length || entries.some((item)=>item.id !== legacyObjectId(item.legacyId))) throw new Error("Invalid deterministic identity");
  return getDb().transaction(async (tx) => {
    const report = { dryRun, wouldFill: 0, filled: 0, alreadySet: 0, notImported: 0, missingObject: 0, mappings: [] as { id: string; category: string; result: string }[] };
    if (!entries.length) return report;
    const ids = entries.map((entry)=>entry.id);
    const query = tx.select({ id: objects.id, category: objects.category }).from(objects).where(inArray(objects.id,ids));
    const current = dryRun ? await query : await query.for("update");
    const imported = new Set((await tx.selectDistinct({ id: objectUpdates.objectId }).from(objectUpdates).where(and(inArray(objectUpdates.objectId,ids),eq(objectUpdates.type,"legacy_import")))).map((item)=>item.id));
    for (const entry of entries) {
      const object = current.find((item)=>item.id===entry.id);
      let result: string;
      if (!object) { report.missingObject++; result="missing_object"; }
      else if (!imported.has(entry.id)) { report.notImported++; result="not_imported"; }
      else if (object.category !== null) { report.alreadySet++; result="already_set"; }
      else {
        report.wouldFill++; result=dryRun?"would_fill":"filled";
        if (!dryRun) {
          const changed = await tx.update(objects).set({ category: entry.category }).where(and(eq(objects.id,entry.id),isNull(objects.category))).returning({id:objects.id});
          if (changed.length !== 1) throw new Error("Category changed concurrently");
          report.filled++;
        }
      }
      report.mappings.push({id:entry.id,category:entry.category,result});
    }
    return report;
  }, { accessMode: dryRun ? "read only" : "read write" });
}
