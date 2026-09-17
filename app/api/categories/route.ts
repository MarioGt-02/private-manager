import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeDataAccess, dataError, privateHeaders } from "@/lib/api/data";
import { categoryInputSchema, categoryAssignmentSchema } from "@/lib/categories/model";
import { assignCategory, getCategories, saveCategory } from "@/lib/db/categories";
export const runtime = "nodejs";
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), category: categoryInputSchema }).strict(),
  z.object({ action: z.literal("update"), id: z.string().uuid(), category: categoryInputSchema }).strict(),
  categoryAssignmentSchema.extend({ action: z.literal("assign") }).strict(),
]);
export async function GET() {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  try { return NextResponse.json({ categories: await getCategories() }, { headers: privateHeaders }); }
  catch { return dataError(500, "DATABASE_ERROR", "Could not load categories."); }
}
export async function POST(request: Request) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const parsed = mutation.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return dataError(400, "INVALID_REQUEST", "Invalid category change.");
  try {
    const data = parsed.data;
    const result = data.action === "assign" ? await assignCategory(data.objectId, data.categoryId) : { category: await saveCategory(data.category, data.action === "update" ? data.id : undefined) };
    return NextResponse.json(result, { headers: privateHeaders });
  } catch { return dataError(409, "CATEGORY_CHANGE_FAILED", "Could not save category. Check for a duplicate name or reload and retry."); }
}
