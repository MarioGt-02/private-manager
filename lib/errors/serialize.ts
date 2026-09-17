import type {
  AppErrorCode,
  ErrorDebug,
  ErrorDetail,
  ErrorEnvelope,
  ValidationIssue,
} from "./types";

/** Generate a unique request/debug ID. Safe in both Node and the browser. */
export function newRequestId(): string {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `req_${id}`;
}

export interface IssueLike {
  path: Array<string | number>;
  message: string;
}

/** Convert Zod (or similar) issues into readable, bounded validation issues. */
export function toValidationIssues(
  issues: IssueLike[],
  limit = 20,
): ValidationIssue[] {
  return issues.slice(0, limit).map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
}

export function buildErrorBody(input: {
  code: AppErrorCode;
  message: string;
  requestId: string;
  debug?: ErrorDebug;
  includeDebug: boolean;
}): ErrorEnvelope {
  const { code, message, requestId, debug, includeDebug } = input;
  const error: ErrorDetail = { code, message, requestId };
  if (includeDebug && debug && Object.keys(debug).length > 0) {
    error.debug = debug;
  }
  return { error };
}

/** Build the plain-text "Copy debug info" report. Values are already sanitized. */
export function formatDebugReport(detail: ErrorDetail, now = new Date()): string {
  const d = detail.debug;
  const lines: string[] = [
    "Private Manager Debug Report",
    `Time: ${now.toISOString()}`,
    `Request ID: ${detail.requestId}`,
  ];
  if (d?.feature) lines.push(`Feature: ${d.feature}`);
  if (d?.route) lines.push(`Route: ${d.route}`);
  lines.push(`Error Code: ${detail.code}`);
  if (d?.provider) lines.push(`Provider: ${d.provider}`);
  if (d?.model) lines.push(`Model: ${d.model}`);
  if (d?.upstreamStatus !== undefined) lines.push(`HTTP Status: ${d.upstreamStatus}`);
  if (d?.upstreamCode) lines.push(`Upstream Code: ${d.upstreamCode}`);
  if (d?.upstreamRequestId) lines.push(`Upstream Request ID: ${d.upstreamRequestId}`);
  lines.push(`Message: ${detail.message}`);
  if (d?.details) lines.push(`Details: ${d.details}`);
  if (d?.validationIssues && d.validationIssues.length > 0) {
    lines.push("Validation:");
    for (const issue of d.validationIssues) {
      lines.push(`- ${issue.path}: ${issue.message}`);
    }
  }
  return lines.join("\n");
}
