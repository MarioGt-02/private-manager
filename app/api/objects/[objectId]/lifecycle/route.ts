import { NextResponse } from "next/server";
import { authorizeDataAccess, dataError, privateHeaders } from "@/lib/api/data";
import { objectIdSchema, lifecycleSchema } from "@/lib/archive/schemas";
import { changeObjectLifecycle, ObjectNotFoundError } from "@/lib/db/archive";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const id = objectIdSchema.safeParse((await params).objectId);
  const input = lifecycleSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success) return dataError(400, "INVALID_REQUEST", "Invalid Object action. Confirm cancellation before continuing.");
  try { return NextResponse.json({ object: await changeObjectLifecycle(id.data, input.data.action) }, { headers: privateHeaders }); }
  catch (error) { return error instanceof ObjectNotFoundError ? dataError(404, "OBJECT_NOT_FOUND", "Object not found.") : dataError(500, "DATABASE_ERROR", "Could not save the Object action."); }
}
