import { NextResponse } from "next/server";
import { requireAuth, UnauthorizedError } from "@/lib/auth/require-auth";
import { applyTimeEstimates } from "@/lib/db/estimates";
import { estimateApplySchema, EstimateValidationError } from "@/lib/estimates/model";
import { errorResponse } from "@/lib/errors/server";
import { newRequestId, toValidationIssues } from "@/lib/errors/serialize";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const requestId = newRequestId();
  const fail = (code: Parameters<typeof errorResponse>[0]["code"], message: string, debug?: Parameters<typeof errorResponse>[0]["debug"]) => errorResponse({ code, message, requestId, feature: "ai_estimate_time", route: "/api/ai/objects/[objectId]/estimate-time/apply", debug });
  try { await requireAuth(); } catch (error) { return fail(error instanceof UnauthorizedError ? "UNAUTHORIZED" : "INTERNAL_ERROR", "Authentication could not be verified."); }
  const input = estimateApplySchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return fail("INVALID_REQUEST", "Invalid estimate proposal.", { validationIssues: toValidationIssues(input.error.issues) });
  const { objectId } = await params;
  try { return NextResponse.json({ object: await applyTimeEstimates(objectId, input.data.proposal) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    if (error instanceof EstimateValidationError) return fail(error.code, error.message);
    return fail("DATABASE_ERROR", "Could not apply estimates. No estimates were applied; please retry.");
  }
}