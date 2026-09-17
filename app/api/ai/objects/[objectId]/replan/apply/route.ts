import { NextResponse } from "next/server";
import { requireAuth, UnauthorizedError } from "@/lib/auth/require-auth";
import { getObject, applyAIReplan } from "@/lib/db/queries";
import { replanApplySchema } from "@/lib/ai/replan";
import { errorResponse } from "@/lib/errors/server";
import { newRequestId, toValidationIssues } from "@/lib/errors/serialize";

export const runtime = "nodejs";

const FEATURE = "ai_replan";
const ROUTE = "/api/ai/objects/[objectId]/replan/apply";

export async function POST(request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const requestId = newRequestId();

  try { await requireAuth(); } catch (error) {
    if (error instanceof UnauthorizedError) {
      return errorResponse({ code: "UNAUTHORIZED", message: "Authentication required.", requestId, feature: FEATURE, route: ROUTE });
    }
    return errorResponse({ code: "INTERNAL_ERROR", message: "Authentication could not be verified.", requestId, feature: FEATURE, route: ROUTE });
  }

  const body = await request.json().catch(() => null);
  const parsed = replanApplySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse({
      code: "INVALID_REQUEST",
      message: "Invalid replan proposal.",
      requestId,
      feature: FEATURE,
      route: ROUTE,
      debug: { validationIssues: toValidationIssues(parsed.error.issues) },
    });
  }

  const { objectId } = await params;
  if (!(await getObject(objectId))) {
    return errorResponse({ code: "OBJECT_NOT_FOUND", message: "Object not found.", requestId, feature: FEATURE, route: ROUTE });
  }

  try {
    return NextResponse.json({ object: await applyAIReplan(objectId, parsed.data.proposal) });
  } catch (error) {
    if (error instanceof Error && error.message === "UPDATE_CONFLICT") {
      return errorResponse({ code: "UPDATE_CONFLICT", message: "The Object changed before this replan was applied.", requestId, feature: FEATURE, route: ROUTE });
    }
    return errorResponse({ code: "DATABASE_ERROR", message: "Could not apply replan.", requestId, feature: FEATURE, route: ROUTE, cause: error });
  }
}
