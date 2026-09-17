import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./index";
import { categories, objects, objectUpdates } from "./schema";
import { DEFAULT_CATEGORIES } from "@/lib/categories/model";
import { mapLegacyCategory } from "@/lib/categories/backfill";

/** Explicit one-time job. Only categoryId is written. Read-only transactions
 * enforce dry-run safety; locks protect concurrent manual assignments. */
export async function backfillBroadCategories(dryRun = true) {
  return getDb().transaction(async (tx) => {
    const report = { dryRun, totalImported: 0, assignments: Object.fromEntries(DEFAULT_CATEGORIES.map((category) => [category.name, 0])), uncategorized: 0, alreadyCategorized: 0, invalidMetadata: 0, changed: 0 };
    const imported = new Set((await tx.selectDistinct({ id: objectUpdates.objectId }).from(objectUpdates).where(eq(objectUpdates.type, "legacy_import"))).map((row) => row.id));
    const query = tx.select().from(objects).orderBy(objects.id);
    const rows = dryRun ? await query : await query.for("update");
    const existingCategories = new Set((await tx.select({ id: categories.id }).from(categories)).map((row) => row.id));
    for (const row of rows) {
      if (!imported.has(row.id)) continue;
      report.totalImported++;
      if (row.categoryId !== null) { report.alreadyCategorized++; continue; }
      if (!row.category?.trim()) { report.invalidMetadata++; continue; }
      const mapped = mapLegacyCategory(row.category);
      if (!mapped) { report.uncategorized++; continue; }
      if (!existingCategories.has(mapped.id)) throw new Error("Default categories missing; apply migration first.");
      report.assignments[mapped.name]++;
      if (!dryRun) {
        const changed = await tx.update(objects).set({ categoryId: mapped.id }).where(and(eq(objects.id, row.id), isNull(objects.categoryId))).returning({ id: objects.id });
        if (changed.length !== 1) throw new Error("Category changed concurrently.");
        report.changed++;
      }
    }
    return report;
  }, { accessMode: dryRun ? "read only" : "read write", isolationLevel: "repeatable read" });
}
