import { NextResponse } from "next/server";
import { requireAuth, UnauthorizedError } from "@/lib/auth/require-auth";
import { finalizeRequestSchema, normalizeDraft } from "@/lib/ai/schemas";
import { createObject } from "@/lib/db/queries";
import { InvalidCategoryError } from "@/lib/categories/suggestion";
import { errorResponse } from "@/lib/errors/server";
import { newRequestId, toValidationIssues } from "@/lib/errors/serialize";

export const runtime = "nodejs";

const FEATURE = "ai_create";
const ROUTE = "/api/ai/create-object/finalize";

/**
 * Finalization phase. Receives the currently visible, user-confirmed draft,
 * validates and normalizes it, then creates exactly one Object transactionally.
 *
 * This endpoint does NOT call OpenAI. The user-confirmed draft is the source
 * of truth.
 */
export async function POST(request: Request) {
  const requestId = newRequestId();

  try { await requireAuth(); }
  catch (error) {
    if (error instanceof UnauthorizedError) {
      return errorResponse({ code: "UNAUTHORIZED", message: "Authentication required.", requestId, feature: FEATURE, route: ROUTE });
    }
    return errorResponse({ code: "INTERNAL_ERROR", message: "Authentication could not be verified.", requestId, feature: FEATURE, route: ROUTE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: "DRAFT_INVALID", message: "Request body must be valid JSON.", requestId, feature: FEATURE, route: ROUTE });
  }

  const parsed = finalizeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse({
      code: "DRAFT_INVALID",
      message: "The draft is invalid.",
      requestId,
      feature: FEATURE,
      route: ROUTE,
      debug: { validationIssues: toValidationIssues(parsed.error.issues) },
    });
  }

  const normalized = normalizeDraft(parsed.data.draft);
  if (!normalized) {
    return errorResponse({
      code: "DRAFT_INVALID",
      message: "The draft must include a title, goal, current state, next action, and at least one checklist item.",
      requestId,
      feature: FEATURE,
      route: ROUTE,
    });
  }

  try {
    const object = await createObject({
      categoryId: parsed.data.draft.categoryId,
      title: normalized.title,
      goal: normalized.goal,
      currentState: normalized.currentState,
      nextAction: normalized.nextAction,
      status: "idea",
      checklist: normalized.checklist,
      activityContent: "Object created with AI assistance.",
    });

    return NextResponse.json({ object });
  } catch (error) {
    if (error instanceof InvalidCategoryError) {
      return errorResponse({ code: "DRAFT_INVALID", message: error.message, requestId, feature: FEATURE, route: ROUTE });
    }
    return errorResponse({
      code: "DATABASE_ERROR",
      message: "Could not create the object. Please try again.",
      requestId,
      feature: FEATURE,
      route: ROUTE,
      cause: error,
    });
  }
}
