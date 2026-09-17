import { parse } from "csv-parse/sync";
import { z } from "zod";
import { legacyObjectId } from "./kanbantool";
export const categoryEntriesSchema = z.array(z.object({ id: z.string().uuid(), legacyId: z.string().regex(/^\d+$/), category: z.string().trim().min(1).max(100) }).strict());
export type CategoryEntry = z.infer<typeof categoryEntriesSchema>[number];
export function planCategoryBackfill(source: string) {
  const rows: Record<string,string>[] = parse(source.replace(/^\uFEFF/, "").replace(/^sep=\t\r?\n/, ""), { delimiter: "\t", columns: true, bom: true, skip_empty_lines: true });
  const entries: CategoryEntry[] = []; const seen = new Set<string>(); let missingCategory = 0;
  for (const row of rows) {
    if (!("ID" in row) || !("Tipo carta" in row)) throw new Error("Missing ID or Tipo carta column");
    const legacyId = row.ID.trim(); const category = row["Tipo carta"].trim();
    if (!/^\d+$/.test(legacyId) || seen.has(legacyId)) throw new Error("Invalid or duplicate legacy ID");
    seen.add(legacyId);
    if (!category) { missingCategory++; continue; }
    entries.push({ id: legacyObjectId(legacyId), legacyId, category });
  }
  return { total: rows.length, missingCategory, entries: categoryEntriesSchema.parse(entries) };
}
