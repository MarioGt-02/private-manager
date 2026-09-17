import { NextResponse } from "next/server";
import { authorizeDataAccess, dataError, privateHeaders } from "@/lib/api/data";
import { objectIdSchema } from "@/lib/archive/schemas";
import { deleteObject, getObject } from "@/lib/db/queries";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const id = objectIdSchema.safeParse((await params).objectId);
  if (!id.success) return dataError(400, "INVALID_REQUEST", "Invalid Object ID.");
  try { const object = await getObject(id.data); return object ? NextResponse.json({ object }, { headers: privateHeaders }) : dataError(404, "OBJECT_NOT_FOUND", "Object not found."); }
  catch { return dataError(500, "DATABASE_ERROR", "Could not load Object."); }
}

const deleteRequestSchema = z.object({ confirmed: z.literal(true) }).strict();
export async function DELETE(request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const id = objectIdSchema.safeParse((await params).objectId);
  const input = deleteRequestSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success) return dataError(400, "INVALID_REQUEST", "Confirm deletion before continuing.");
  try {
    // Existing foreign keys atomically cascade to the checklist and Activity.
    // Idempotent so retrying after a lost response is safe.
    await deleteObject(id.data);
    return new NextResponse(null, { status: 204, headers: privateHeaders });
  } catch { return dataError(500, "DATABASE_ERROR", "Could not delete Object. Please try again."); }
}
