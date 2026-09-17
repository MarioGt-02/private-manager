import type { ErrorDetail } from "./types";

/**
 * Client-side helpers for consuming the server error envelope. No server-only
 * imports.
 */

/** Error carrying a parsed server error envelope for cross-layer propagation. */
export class ApiError extends Error {
  detail: ErrorDetail;
  constructor(detail: ErrorDetail) {
    super(detail.message);
    this.name = "ApiError";
    this.detail = detail;
  }
}

/** Parse an arbitrary response payload into a safe ErrorDetail. */
export function parseErrorDetail(
  payload: unknown,
  fallbackMessage: string,
): ErrorDetail {
  const fallback: ErrorDetail = {
    code: "INTERNAL_ERROR",
    message: fallbackMessage,
    requestId: "",
  };
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return fallback;
  const e = error as {
    code?: unknown;
    message?: unknown;
    requestId?: unknown;
    debug?: unknown;
  };
  const detail: ErrorDetail = {
    code: typeof e.code === "string" ? e.code : "INTERNAL_ERROR",
    message:
      typeof e.message === "string" && e.message ? e.message : fallbackMessage,
    requestId: typeof e.requestId === "string" ? e.requestId : "",
  };
  if (e.debug && typeof e.debug === "object") {
    detail.debug = e.debug as ErrorDetail["debug"];
  }
  return detail;
}

/** Build an ErrorDetail for a client-side failure with no server request ID. */
export function localError(message: string): ErrorDetail {
  return { code: "INTERNAL_ERROR", message, requestId: "" };
}
