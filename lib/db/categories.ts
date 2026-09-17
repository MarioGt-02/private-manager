import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./index";
import { categories, objects } from "./schema";
import { categoryInputSchema } from "@/lib/categories/model";

export async function getCategories() {
  const rows = await getDb().select().from(categories).orderBy(asc(categories.name));
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
export async function getCategoryOptions() {
  return getDb().select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name));
}
export async function saveCategory(input: unknown, id?: string) {
  const data = categoryInputSchema.parse(input);
  const rows = id
    ? await getDb().update(categories).set(data).where(eq(categories.id, id)).returning()
    : await getDb().insert(categories).values({ ...data, id: randomUUID() }).returning();
  if (!rows[0]) throw new Error("Category not found.");
  return { ...rows[0], createdAt: rows[0].createdAt.toISOString() };
}
export async function assignCategory(objectId: string, categoryId: string | null) {
  return getDb().transaction(async (tx) => {
    const [object] = await tx.select().from(objects).where(eq(objects.id, objectId)).for("update");
    if (!object || object.archivedAt) throw new Error("Object unavailable.");
    const [next] = categoryId ? await tx.select().from(categories).where(eq(categories.id, categoryId)).for("share") : [];
    if (categoryId && !next) throw new Error("Category not found.");
    if (object.categoryId === categoryId) return { categoryId };
    await tx.update(objects).set({ categoryId, updatedAt: new Date() }).where(eq(objects.id, objectId));
    return { categoryId };
  });
}
