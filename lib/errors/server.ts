import { NextResponse } from "next/server";
import { redact, redactString, summarizeError, truncate } from "./redact";
import { buildErrorBody } from "./serialize";
import type { AppErrorCode, ErrorDebug, ValidationIssue } from "./types";

export { classifyAIError } from "./classify";

/** Server-side feature flag: whether the client may receive technical debug. */
export function debugDetailsEnabled(): boolean {
  return process.env.DEBUG_ERROR_DETAILS === "true";
}

const CODE_STATUS: Record<AppErrorCode, number> = {
  AI_AUTH_ERROR: 502,
  AI_RATE_LIMITED: 429,
  AI_TIMEOUT: 504,
  AI_NETWORK_ERROR: 502,
  AI_PROVIDER_ERROR: 502,
  AI_RESPONSE_INVALID: 502,
  AI_SCHEMA_VALIDATION_ERROR: 502,
  AI_CONFIG_ERROR: 503,
  VALIDATION_ERROR: 400,
  DATABASE_ERROR: 500,
  AUTH_ERROR: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  AUTH_CONFIG_ERROR: 500,
  INVALID_REQUEST: 400,
  DRAFT_INVALID: 400,
  RATE_LIMITED: 429,
  OBJECT_NOT_FOUND: 404,
  UPDATE_CONFLICT: 409,
};

export function statusForCode(code: AppErrorCode): number {
  return CODE_STATUS[code] ?? 500;
}

export interface ErrorResponseOptions {
  status?: number;
  code: AppErrorCode;
  message: string;
  requestId: string;
  feature?: string;
  route?: string;
  provider?: string;
  model?: string;
  debug?: Partial<ErrorDebug>;
  cause?: unknown;
}

function sanitizeValidationIssues(issues?: ValidationIssue[]): ValidationIssue[] {
  if (!issues) return [];
  return issues.map((issue) => ({
    path: truncate(String(issue.path ?? "(root)"), 200),
    message: redactString(truncate(String(issue.message ?? ""), 300)),
  }));
}

/**
 * Build a safe API error response with a request ID and (when enabled) sanitized
 * technical debug details. Always logs the sanitized diagnostics server-side.
 */
export function errorResponse(options: ErrorResponseOptions) {
  const {
    status,
    code,
    message,
    requestId,
    feature,
    route,
    provider,
    model,
    cause,
  } = options;

  const raw: ErrorDebug = {
    feature,
    route,
    provider,
    model,
    ...(options.debug ?? {}),
  };

  const debug: ErrorDebug = {};
  if (raw.feature) debug.feature = raw.feature;
  if (raw.route) debug.route = raw.route;
  if (raw.provider) debug.provider = raw.provider;
  if (raw.model) debug.model = raw.model;
  if (raw.upstreamStatus !== undefined) debug.upstreamStatus = raw.upstreamStatus;
  if (raw.upstreamCode) debug.upstreamCode = truncate(redactString(String(raw.upstreamCode)), 120);
  if (raw.upstreamRequestId) debug.upstreamRequestId = truncate(String(raw.upstreamRequestId), 120);
  if (raw.details) debug.details = redactString(truncate(String(raw.details), 500));
  const issues = sanitizeValidationIssues(raw.validationIssues);
  if (issues.length > 0) debug.validationIssues = issues;

  logError({
    requestId,
    feature,
    route,
    code,
    provider,
    model,
    upstreamStatus: debug.upstreamStatus,
    upstreamCode: debug.upstreamCode,
    message,
    details: debug.details,
    validationIssues: debug.validationIssues,
    causeMessage: cause ? summarizeError(cause) : undefined,
  });

  const body = buildErrorBody({
    code,
    message,
    requestId,
    debug,
    includeDebug: debugDetailsEnabled(),
  });

  return NextResponse.json(body, {
    status: status ?? statusForCode(code),
    headers: { "Cache-Control": "no-store" },
  });
}

interface LogEntry {
  requestId: string;
  feature?: string;
  route?: string;
  code: AppErrorCode;
  provider?: string;
  model?: string;
  upstreamStatus?: number;
  upstreamCode?: string;
  message: string;
  details?: string;
  validationIssues?: ValidationIssue[];
  causeMessage?: string;
}

/** Structured, redacted server-side error log (findable via `docker compose logs app`). */
export function logError(entry: LogEntry) {
  const sanitized = redact(entry) as Record<string, unknown>;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(sanitized)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      parts.push(`${key}=${JSON.stringify(value)}`);
    } else if (typeof value === "object") {
      parts.push(`${key}=${JSON.stringify(value)}`);
    } else {
      parts.push(`${key}=${String(value).replace(/\s+/g, " ")}`);
    }
  }
  console.error(`[PrivateManagerError] ${parts.join(" ")}`);
}
