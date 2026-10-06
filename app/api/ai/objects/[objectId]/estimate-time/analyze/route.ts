import { NextResponse } from "next/server";
import { requireAuth, UnauthorizedError } from "@/lib/auth/require-auth";
import { getObject } from "@/lib/db/queries";
import { getOpenAIClient } from "@/lib/ai/openai";
import { CREATE_OBJECT_MODEL, OPENAI_REASONING_EFFORT, OPENAI_STORE } from "@/lib/ai/prompts";
import { ESTIMATE_PROMPT, estimateRequestSchema, estimateOutputSchema, estimateSnapshot, getEstimateTargets, validateEstimateOutput, EstimateValidationError } from "@/lib/estimates/model";
import { getActionableLeaves } from "@/lib/estimates/time";
import { classifyAIError, errorResponse } from "@/lib/errors/server";
import { newRequestId, toValidationIssues } from "@/lib/errors/serialize";

export const runtime = "nodejs";
const FEATURE = "ai_estimate_time";
const ROUTE = "/api/ai/objects/[objectId]/estimate-time/analyze";
const format = {
  type: "json_schema" as const, name: "effort_estimates", strict: true,
  schema: { type: "object", additionalProperties: false, required: ["estimates", "warning"], properties: {
    estimates: { type: "array", items: { type: "object", additionalProperties: false, required: ["checklistItemId", "estimatedMinutes"], properties: {
      checklistItemId: { type: "string" }, estimatedMinutes: { anyOf: [{ type: "integer" }, { type: "null" }] },
    } } }, warning: { anyOf: [{ type: "string" }, { type: "null" }] },
  } },
};
export async function POST(request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const requestId = newRequestId();
  const fail = (code: Parameters<typeof errorResponse>[0]["code"], message: string, debug?: Parameters<typeof errorResponse>[0]["debug"]) => errorResponse({ code, message, requestId, feature: FEATURE, route: ROUTE, provider: "openai", model: CREATE_OBJECT_MODEL, debug });
  try { await requireAuth(); } catch (error) { return fail(error instanceof UnauthorizedError ? "UNAUTHORIZED" : "INTERNAL_ERROR", "Authentication could not be verified."); }
  const input = estimateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return fail("INVALID_REQUEST", "Choose Estimate Missing or Re-estimate All.", { validationIssues: toValidationIssues(input.error.issues) });
  const { objectId } = await params;
  let object;
  try { object = await getObject(objectId); } catch { return fail("DATABASE_ERROR", "Could not load the Object for estimation."); }
  if (!object) return fail("OBJECT_NOT_FOUND", "Object not found.");
  if (object.archivedAt || object.cancelledAt) return fail("CONFLICT", "Restore this historical Object before estimating time.");
  if (!getActionableLeaves(object.checklist).length) return fail("INVALID_REQUEST", "Add checklist items before estimating time.");
  const targets = getEstimateTargets(object.checklist, input.data.mode);
  const snapshot = estimateSnapshot(object.checklist);
  if (snapshot.length > 500) return fail("INVALID_REQUEST", "Time estimation supports up to 500 checklist items per Object.");
  if (!targets.length) return NextResponse.json({ proposal: { mode: input.data.mode, snapshot, estimates: [], warning: "All actionable checklist items already have estimates." } }, { headers: { "Cache-Control": "no-store" } });
  const context = {
    object: { title: object.title, goal: object.goal, currentState: object.currentState, nextAction: object.nextAction, category: object.category },
    checklist: snapshot, mode: input.data.mode, targetChecklistItemIds: targets.map((item) => item.id),
  };
  try {
    const response = await getOpenAIClient().responses.create({
      model: CREATE_OBJECT_MODEL, reasoning: { effort: OPENAI_REASONING_EFFORT }, store: OPENAI_STORE,
      max_output_tokens: 8192, instructions: ESTIMATE_PROMPT,
      input: [{ role: "system", content: ESTIMATE_PROMPT }, { role: "user", content: JSON.stringify(context) }],
      text: { format: { ...format, schema: { ...format.schema, properties: { ...format.schema.properties, estimates: { ...format.schema.properties.estimates, items: { ...format.schema.properties.estimates.items, properties: { ...format.schema.properties.estimates.items.properties, checklistItemId: { type: "string", enum: targets.map((item) => item.id) } } } } } } } },
    });
    let raw;
    try { raw = JSON.parse(response.output_text); } catch { return fail("AI_RESPONSE_INVALID", "AI returned an invalid time estimate. Please retry."); }
    const output = estimateOutputSchema.safeParse(raw);
    if (!output.success) return fail("AI_SCHEMA_VALIDATION_ERROR", "AI returned invalid estimate values. Please retry.", { validationIssues: toValidationIssues(output.error.issues) });
    try { validateEstimateOutput(output.data, object.checklist, input.data.mode); }
    catch (error) { if (error instanceof EstimateValidationError) return fail("AI_RESPONSE_INVALID", error.message); throw error; }
    return NextResponse.json({ proposal: { ...output.data, mode: input.data.mode, snapshot } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const classified = classifyAIError(error, { provider: "openai", model: CREATE_OBJECT_MODEL });
    return errorResponse({ ...classified, requestId, feature: FEATURE, route: ROUTE, provider: "openai", model: CREATE_OBJECT_MODEL, cause: error });
  }
}