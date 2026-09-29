import { NextResponse } from "next/server";
import { requireAuth, UnauthorizedError } from "@/lib/auth/require-auth";
import { updateChecklistEstimate } from "@/lib/db/estimates";
import { manualEstimateSchema, EstimateValidationError } from "@/lib/estimates/model";
import { errorResponse } from "@/lib/errors/server";
import { newRequestId } from "@/lib/errors/serialize";

export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const requestId = newRequestId();
  const fail = (code: Parameters<typeof errorResponse>[0]["code"], message: string) => errorResponse({ code, message, requestId, feature: "checklist_estimate", route: "/api/objects/[objectId]/checklist-estimate" });
  try { await requireAuth(); } catch (error) { return fail(error instanceof UnauthorizedError ? "UNAUTHORIZED" : "INTERNAL_ERROR", "Authentication could not be verified."); }
  const input = manualEstimateSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return fail("INVALID_REQUEST", "Use integer minutes between 1 and 525600, or clear the estimate.");
  const { objectId } = await params;
  try { return NextResponse.json({ object: await updateChecklistEstimate(objectId, input.data.itemId, input.data.estimatedMinutes) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return fail(error instanceof EstimateValidationError ? error.code : "DATABASE_ERROR", error instanceof EstimateValidationError ? error.message : "Could not save the estimate. Please retry."); }
}