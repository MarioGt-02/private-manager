import { NextResponse } from "next/server";
import { requireAuth, UnauthorizedError } from "@/lib/auth/require-auth";
import { getObject, getRecentObjectUpdates } from "@/lib/db/queries";
import { getOpenAIClient } from "@/lib/ai/openai";
import { CREATE_OBJECT_MODEL, OPENAI_REASONING_EFFORT, OPENAI_STORE } from "@/lib/ai/prompts";
import { progressRequestSchema, progressUpdateSchema, PROGRESS_SYSTEM_PROMPT } from "@/lib/ai/progress";
import { buildChecklistTree } from "@/lib/objects/next-action";
import { classifyAIError, errorResponse, statusForCode } from "@/lib/errors/server";
import { newRequestId, toValidationIssues } from "@/lib/errors/serialize";
import { ERROR_MESSAGES } from "@/lib/errors/types";

export const runtime = "nodejs";

const FEATURE = "ai_progress";
const ROUTE = "/api/ai/objects/[objectId]/progress/analyze";
const PROVIDER = "openai";

const format = {
  type: "json_schema" as const,
  name: "ai_progress_update",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["currentState", "nextAction", "completedItemIds", "reopenedItemIds", "newChecklistItems", "summary"],
    properties: {
      currentState: { type: "string" },
      nextAction: { type: "string" },
      completedItemIds: { type: "array", items: { type: "string" } },
      reopenedItemIds: { type: "array", items: { type: "string" } },
      newChecklistItems: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["title", "parentItemId"], properties: { title: { type: "string" }, parentItemId: { anyOf: [{ type: "string" }, { type: "null" }] } } } },
      summary: { type: "string" },
    },
  },
};

export async function POST(request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const requestId = newRequestId();

  try { await requireAuth(); } catch (error) {
    if (error instanceof UnauthorizedError) {
      return errorResponse({ code: "UNAUTHORIZED", message: "Authentication required.", requestId, feature: FEATURE, route: ROUTE });
    }
    return errorResponse({ code: "INTERNAL_ERROR", message: "Authentication could not be verified.", requestId, feature: FEATURE, route: ROUTE });
  }

  const body = await request.json().catch(() => null);
  const parsed = progressRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse({
      code: "INVALID_REQUEST",
      message: "Invalid progress message.",
      requestId,
      feature: FEATURE,
      route: ROUTE,
      debug: { validationIssues: toValidationIssues(parsed.error.issues) },
    });
  }

  const { objectId } = await params;

  let object;
  let recentUpdates;
  try {
    object = await getObject(objectId);
    if (!object) {
      return errorResponse({ code: "OBJECT_NOT_FOUND", message: "Object not found.", requestId, feature: FEATURE, route: ROUTE });
    }
    recentUpdates = await getRecentObjectUpdates(objectId, 10);
  } catch (error) {
    return errorResponse({ code: "DATABASE_ERROR", message: "Could not load the Object.", requestId, feature: FEATURE, route: ROUTE, cause: error });
  }

  try {
    const response = await getOpenAIClient().responses.create({
      model: CREATE_OBJECT_MODEL,
      reasoning: { effort: OPENAI_REASONING_EFFORT },
      store: OPENAI_STORE,
      max_output_tokens: 8192,
      instructions: PROGRESS_SYSTEM_PROMPT,
      input: [
        { role: "system", content: PROGRESS_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ object: { ...object, checklist: buildChecklistTree(object.checklist) }, recentUpdates, report: parsed.data.message }) },
      ],
      text: { format },
    });

    const content = response.output_text;
    if (!content) {
      return errorResponse({ code: "AI_RESPONSE_INVALID", message: ERROR_MESSAGES.AI_RESPONSE_INVALID, requestId, feature: FEATURE, route: ROUTE, provider: PROVIDER, model: CREATE_OBJECT_MODEL, debug: { details: "Provider returned empty output text." } });
    }

    let json: unknown;
    try { json = JSON.parse(content); }
    catch {
      return errorResponse({ code: "AI_RESPONSE_INVALID", message: ERROR_MESSAGES.AI_RESPONSE_INVALID, requestId, feature: FEATURE, route: ROUTE, provider: PROVIDER, model: CREATE_OBJECT_MODEL, debug: { details: "Provider output was not valid JSON." } });
    }

    const update = progressUpdateSchema.safeParse(json);
    if (!update.success) {
      return errorResponse({
        code: "AI_SCHEMA_VALIDATION_ERROR",
        message: ERROR_MESSAGES.AI_SCHEMA_VALIDATION_ERROR,
        requestId,
        feature: FEATURE,
        route: ROUTE,
        provider: PROVIDER,
        model: CREATE_OBJECT_MODEL,
        debug: { validationIssues: toValidationIssues(update.error.issues) },
      });
    }

    return NextResponse.json({ update: update.data });
  } catch (error) {
    const classified = classifyAIError(error, { provider: PROVIDER, model: CREATE_OBJECT_MODEL });
    return errorResponse({
      status: statusForCode(classified.code),
      code: classified.code,
      message: classified.message,
      requestId,
      feature: FEATURE,
      route: ROUTE,
      provider: PROVIDER,
      model: CREATE_OBJECT_MODEL,
      debug: classified.debug,
      cause: error,
    });
  }
}
