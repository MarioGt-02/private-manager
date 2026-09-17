import type { AppErrorCode, ErrorDebug } from "./types";

export interface ClassifiedAIError {
  code: AppErrorCode;
  message: string;
  debug: ErrorDebug;
}

interface ProviderErrorLike {
  status?: number;
  code?: string | null;
  type?: string;
  name?: string;
  message?: string;
  request_id?: string;
  headers?: Record<string, string>;
  error?: { code?: string; message?: string; type?: string };
  cause?: unknown;
}

const TIMEOUT_PATTERN = /timeout|timed out|aborted/i;
const NETWORK_PATTERN = /fetch failed|econnrefused|enotfound|eai_again|network|socket|connection|dns|self-signed|certificate/i;

/**
 * Normalize a provider error into a stable diagnostic category while preserving
 * safe upstream metadata (status, code, upstream request id). Never exposes
 * upstream secrets.
 */
export function classifyAIError(
  error: unknown,
  context: { provider?: string; model?: string } = {},
): ClassifiedAIError {
  const e = (error ?? {}) as ProviderErrorLike;
  const status = typeof e.status === "number" ? e.status : undefined;
  const upstreamCode = e.code ?? e.error?.code ?? e.type ?? undefined;
  const upstreamRequestId = e.request_id ?? e.headers?.["x-request-id"] ?? undefined;

  const debug: ErrorDebug = {
    provider: context.provider,
    model: context.model,
    upstreamStatus: status,
    upstreamCode: upstreamCode ? String(upstreamCode) : undefined,
    upstreamRequestId: upstreamRequestId ? String(upstreamRequestId) : undefined,
  };

  if (status === 401 || status === 403) {
    return { code: "AI_AUTH_ERROR", message: "AI provider authentication failed.", debug };
  }
  if (status === 429) {
    return {
      code: "AI_RATE_LIMITED",
      message: "The AI provider rate limit was reached. Try again shortly.",
      debug,
    };
  }

  const name = e.name ?? "";
  const message = e.message ?? "";
  if (name.includes("Timeout") || name === "AbortError" || TIMEOUT_PATTERN.test(message)) {
    return { code: "AI_TIMEOUT", message: "The AI request timed out.", debug };
  }
  if (name.includes("Connection") || NETWORK_PATTERN.test(message) || hasNetworkCause(error)) {
    return {
      code: "AI_NETWORK_ERROR",
      message: "Private Manager could not reach the AI provider.",
      debug,
    };
  }

  if (status !== undefined && status >= 400) {
    return { code: "AI_PROVIDER_ERROR", message: "The AI provider returned an error.", debug };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred while talking to the AI provider.",
    debug,
  };
}

function hasNetworkCause(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) return NETWORK_PATTERN.test(cause.message ?? "");
  return false;
}
