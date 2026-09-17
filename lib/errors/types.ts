/**
 * Client-safe error types shared between the server error serializer and the
 * frontend technical error UI. This module must not import anything server-only.
 */

export type AppErrorCode =
  // AI-specific diagnostic categories
  | "AI_AUTH_ERROR"
  | "AI_RATE_LIMITED"
  | "AI_TIMEOUT"
  | "AI_NETWORK_ERROR"
  | "AI_PROVIDER_ERROR"
  | "AI_RESPONSE_INVALID"
  | "AI_SCHEMA_VALIDATION_ERROR"
  | "AI_CONFIG_ERROR"
  // Generic categories
  | "VALIDATION_ERROR"
  | "DATABASE_ERROR"
  | "AUTH_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  // Existing codes preserved for backward compatibility
  | "UNAUTHORIZED"
  | "INVALID_CREDENTIALS"
  | "AUTH_CONFIG_ERROR"
  | "INVALID_REQUEST"
  | "DRAFT_INVALID"
  | "RATE_LIMITED"
  | "OBJECT_NOT_FOUND"
  | "UPDATE_CONFLICT";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ErrorDebug {
  feature?: string;
  route?: string;
  provider?: string;
  model?: string;
  upstreamStatus?: number;
  upstreamCode?: string;
  upstreamRequestId?: string;
  details?: string;
  validationIssues?: ValidationIssue[];
}

export interface ErrorDetail {
  code: string;
  message: string;
  requestId: string;
  debug?: ErrorDebug;
}

export interface ErrorEnvelope {
  error: ErrorDetail;
}

/** Short user-facing summaries. Raw provider dumps never go in the message. */
export const ERROR_MESSAGES: Record<string, string> = {
  AI_AUTH_ERROR: "AI provider authentication failed.",
  AI_RATE_LIMITED: "The AI provider rate limit was reached. Try again shortly.",
  AI_TIMEOUT: "The AI request timed out.",
  AI_NETWORK_ERROR: "Private Manager could not reach the AI provider.",
  AI_PROVIDER_ERROR: "The AI provider returned an error.",
  AI_RESPONSE_INVALID:
    "The AI provider returned a response Private Manager could not understand.",
  AI_SCHEMA_VALIDATION_ERROR: "The AI response did not match the expected format.",
  AI_CONFIG_ERROR: "AI configuration is incomplete or invalid.",
};
