import { NextResponse } from "next/server";
import { requireAuth, UnauthorizedError } from "@/lib/auth/require-auth";
import { getObject, getRecentObjectUpdates } from "@/lib/db/queries";
import { getOpenAIClient } from "@/lib/ai/openai";
import { CREATE_OBJECT_MODEL, OPENAI_REASONING_EFFORT, OPENAI_STORE } from "@/lib/ai/prompts";
import { replanProposalSchema, replanRequestSchema, REPLAN_PROMPT } from "@/lib/ai/replan";
import { buildChecklistTree } from "@/lib/objects/next-action";
import { classifyAIError, errorResponse, statusForCode } from "@/lib/errors/server";
import { newRequestId, toValidationIssues } from "@/lib/errors/serialize";
import { ERROR_MESSAGES } from "@/lib/errors/types";

export const runtime = "nodejs";

const FEATURE = "ai_replan";
const ROUTE = "/api/ai/objects/[objectId]/replan/analyze";
const PROVIDER = "openai";

const format = {
  type: "json_schema" as const,
  name: "ai_replan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "goal", "currentState", "reasonSummary", "checklist", "removedItemIds", "summary"],
    properties: {
      title: { anyOf: [{ type: "string" }, { type: "null" }] },
      goal: { anyOf: [{ type: "string" }, { type: "null" }] },
      currentState: { type: "string" },
      reasonSummary: { type: "string" },
      checklist: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["sourceItemId", "title", "completed", "changeType", "children"], properties: { sourceItemId: { anyOf: [{ type: "string" }, { type: "null" }] }, title: { type: "string" }, completed: { type: "boolean" }, changeType: { type: "string", enum: ["keep", "modify", "add"] }, children: { type: "array", maxItems: 10, items: { type: "object", additionalProperties: false, required: ["sourceItemId", "title", "completed", "changeType"], properties: { sourceItemId: { anyOf: [{ type: "string" }, { type: "null" }] }, title: { type: "string" }, completed: { type: "boolean" }, changeType: { type: "string", enum: ["keep", "modify", "add"] } } } } } } },
      removedItemIds: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
    },
  },
};

const parse = (text: string) => {
  const value = text.trim();
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse((match?.[1] ?? value).trim());
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
  const input = replanRequestSchema.safeParse(body);
  if (!input.success) {
    return errorResponse({
      code: "INVALID_REQUEST",
      message: "Invalid replan request.",
      requestId,
      feature: FEATURE,
      route: ROUTE,
      debug: { validationIssues: toValidationIssues(input.error.issues) },
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
      instructions: REPLAN_PROMPT,
      input: [
        { role: "system", content: REPLAN_PROMPT },
        { role: "user", content: JSON.stringify({ object: { ...object, checklist: buildChecklistTree(object.checklist) }, recentUpdates, change: input.data.message }) },
      ],
      text: { format },
    });

    const content = response.output_text;
    if (!content) {
      return errorResponse({ code: "AI_RESPONSE_INVALID", message: ERROR_MESSAGES.AI_RESPONSE_INVALID, requestId, feature: FEATURE, route: ROUTE, provider: PROVIDER, model: CREATE_OBJECT_MODEL, debug: { details: "Provider returned empty output text." } });
    }

    let proposal;
    try { proposal = replanProposalSchema.safeParse(parse(content)); }
    catch {
      return errorResponse({ code: "AI_RESPONSE_INVALID", message: ERROR_MESSAGES.AI_RESPONSE_INVALID, requestId, feature: FEATURE, route: ROUTE, provider: PROVIDER, model: CREATE_OBJECT_MODEL, debug: { details: "Provider output was not valid JSON." } });
    }
    if (!proposal.success) {
      return errorResponse({
        code: "AI_SCHEMA_VALIDATION_ERROR",
        message: ERROR_MESSAGES.AI_SCHEMA_VALIDATION_ERROR,
        requestId,
        feature: FEATURE,
        route: ROUTE,
        provider: PROVIDER,
        model: CREATE_OBJECT_MODEL,
        debug: { validationIssues: toValidationIssues(proposal.error.issues) },
      });
    }

    return NextResponse.json({ proposal: proposal.data });
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
