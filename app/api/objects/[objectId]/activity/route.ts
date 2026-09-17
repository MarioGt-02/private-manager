import { NextResponse } from "next/server";
import { requireAuth, UnauthorizedError } from "@/lib/auth/require-auth";
import { getObjectUpdates } from "@/lib/db/activity";
import { activityObjectIdSchema } from "@/lib/activity/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
function failure(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}
export async function GET(_request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  try {
    await requireAuth();
  } catch (error) {
    if (error instanceof UnauthorizedError) return failure(401, "UNAUTHORIZED", "Authentication required.");
    return failure(500, "INTERNAL_ERROR", "Authentication could not be verified.");
  }
  const parsed = activityObjectIdSchema.safeParse((await params).objectId);
  if (!parsed.success) return failure(400, "INVALID_REQUEST", "Invalid Object ID.");
  try {
    const updates = await getObjectUpdates(parsed.data);
    if (updates === null) return failure(404, "OBJECT_NOT_FOUND", "Object not found.");
    return NextResponse.json({ updates }, { headers });
  } catch {
    return failure(500, "DATABASE_ERROR", "Could not load activity.");
  }
}
