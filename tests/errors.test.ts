import { describe, expect, it } from "vitest";
import { classifyAIError } from "@/lib/errors/classify";
import { isSensitiveKey, redact, redactString, summarizeError } from "@/lib/errors/redact";
import { buildErrorBody, formatDebugReport, newRequestId, toValidationIssues } from "@/lib/errors/serialize";
import { ApiError, localError, parseErrorDetail } from "@/lib/errors/client";

describe("classifyAIError", () => {
  it("maps 401/403 to AI_AUTH_ERROR", () => {
    const result = classifyAIError({ status: 401 });
    expect(result.code).toBe("AI_AUTH_ERROR");
    expect(result.debug.upstreamStatus).toBe(401);
    expect(classifyAIError({ status: 403 }).code).toBe("AI_AUTH_ERROR");
  });

  it("maps 429 to AI_RATE_LIMITED", () => {
    expect(classifyAIError({ status: 429 }).code).toBe("AI_RATE_LIMITED");
  });

  it("maps timeouts to AI_TIMEOUT", () => {
    expect(classifyAIError({ name: "APIConnectionTimeoutError" }).code).toBe("AI_TIMEOUT");
    expect(classifyAIError({ name: "AbortError" }).code).toBe("AI_TIMEOUT");
    expect(classifyAIError({ message: "request timed out" }).code).toBe("AI_TIMEOUT");
  });

  it("maps network failures to AI_NETWORK_ERROR", () => {
    expect(classifyAIError({ name: "APIConnectionError" }).code).toBe("AI_NETWORK_ERROR");
    expect(classifyAIError({ message: "fetch failed" }).code).toBe("AI_NETWORK_ERROR");
    expect(classifyAIError({ message: "ECONNREFUSED" }).code).toBe("AI_NETWORK_ERROR");
  });

  it("maps other upstream errors to AI_PROVIDER_ERROR", () => {
    expect(classifyAIError({ status: 500 }).code).toBe("AI_PROVIDER_ERROR");
  });

  it("maps unknown failures to INTERNAL_ERROR", () => {
    expect(classifyAIError({}).code).toBe("INTERNAL_ERROR");
    expect(classifyAIError(new Error("something unexpected")).code).toBe("INTERNAL_ERROR");
  });

  it("preserves safe upstream metadata", () => {
    const result = classifyAIError(
      { status: 429, code: "rate_limit_exceeded", request_id: "req_upstream" },
      { provider: "openai", model: "gpt-x" },
    );
    expect(result.debug).toMatchObject({
      provider: "openai",
      model: "gpt-x",
      upstreamStatus: 429,
      upstreamCode: "rate_limit_exceeded",
      upstreamRequestId: "req_upstream",
    });
  });
});

describe("redact", () => {
  it("flags common secret key names case-insensitively", () => {
    for (const key of [
      "authorization",
      "Authorization",
      "cookie",
      "set-cookie",
      "api_key",
      "apiKey",
      "api-key",
      "token",
      "secret",
      "password",
      "passwd",
      "DATABASE_URL",
      "connection_string",
    ]) {
      expect(isSensitiveKey(key)).toBe(true);
    }
    expect(isSensitiveKey("title")).toBe(false);
    expect(isSensitiveKey("content")).toBe(false);
    expect(isSensitiveKey("authenticated")).toBe(false);
  });

  it("redacts sensitive keys in nested objects", () => {
    const out = redact({
      headers: { Authorization: "Bearer secret", Cookie: "session=abc" },
      api_key: "sk-secret",
      title: "Keep me",
    }) as Record<string, unknown>;
    const headers = out.headers as Record<string, unknown>;
    expect(headers.Authorization).toBe("[REDACTED]");
    expect(headers.Cookie).toBe("[REDACTED]");
    expect(out.api_key).toBe("[REDACTED]");
    expect(out.title).toBe("Keep me");
  });

  it("redacts secrets embedded inside strings", () => {
    expect(redactString("postgresql://user:secretpass@host:5432/db")).toContain("[REDACTED]");
    expect(redactString("Authorization: Bearer abc123")).toContain("[REDACTED]");
    expect(redactString("key sk-abc123xyz")).toContain("[REDACTED]");
  });

  it("summarizeError never leaks secret values", () => {
    expect(summarizeError(new Error("boom"))).toBe("boom");
    expect(summarizeError({ secret: "top-secret-value" })).not.toContain("top-secret-value");
  });
});

describe("buildErrorBody", () => {
  it("omits debug details when the flag is off", () => {
    const body = buildErrorBody({
      code: "AI_TIMEOUT",
      message: "The AI request timed out.",
      requestId: "req_1",
      debug: { provider: "openai", model: "gpt-x" },
      includeDebug: false,
    });
    expect(body).toEqual({ error: { code: "AI_TIMEOUT", message: "The AI request timed out.", requestId: "req_1" } });
  });

  it("includes sanitized debug details when the flag is on", () => {
    const body = buildErrorBody({
      code: "AI_TIMEOUT",
      message: "The AI request timed out.",
      requestId: "req_1",
      debug: { provider: "openai", model: "gpt-x" },
      includeDebug: true,
    });
    expect(body.error.debug).toEqual({ provider: "openai", model: "gpt-x" });
  });

  it("omits an empty debug object", () => {
    const body = buildErrorBody({ code: "INTERNAL_ERROR", message: "x", requestId: "req_1", debug: {}, includeDebug: true });
    expect(body.error.debug).toBeUndefined();
  });
});

describe("request id", () => {
  it("generates a prefixed, unique request id", () => {
    const id = newRequestId();
    expect(id).toMatch(/^req_/);
    expect(newRequestId()).not.toBe(id);
  });
});

describe("toValidationIssues", () => {
  it("joins paths into readable strings and caps the list", () => {
    const issues = Array.from({ length: 25 }, (_, index) => ({
      path: ["checklist", index],
      message: `bad ${index}`,
    }));
    const out = toValidationIssues(issues, 20);
    expect(out).toHaveLength(20);
    expect(out[0]).toEqual({ path: "checklist.0", message: "bad 0" });
  });
});

describe("formatDebugReport", () => {
  it("produces a plain-text report with sanitized fields", () => {
    const report = formatDebugReport({
      code: "AI_SCHEMA_VALIDATION_ERROR",
      message: "The AI response did not match the expected format.",
      requestId: "req_1",
      debug: {
        feature: "ai_create",
        route: "/api/ai/create-object/chat",
        provider: "openai",
        model: "gpt-x",
        validationIssues: [{ path: "checklist.0.title", message: "Required" }],
      },
    });
    expect(report).toContain("Private Manager Debug Report");
    expect(report).toContain("Request ID: req_1");
    expect(report).toContain("Feature: ai_create");
    expect(report).toContain("Error Code: AI_SCHEMA_VALIDATION_ERROR");
    expect(report).toContain("- checklist.0.title: Required");
  });
});

describe("parseErrorDetail", () => {
  it("parses a full error envelope", () => {
    const detail = parseErrorDetail(
      { error: { code: "AI_TIMEOUT", message: "timed out", requestId: "req_1", debug: { provider: "openai" } } },
      "fallback",
    );
    expect(detail).toEqual({ code: "AI_TIMEOUT", message: "timed out", requestId: "req_1", debug: { provider: "openai" } });
  });

  it("falls back safely on malformed payloads", () => {
    expect(parseErrorDetail(null, "fallback")).toEqual({ code: "INTERNAL_ERROR", message: "fallback", requestId: "" });
    expect(parseErrorDetail({ error: { code: 123 } }, "fallback").message).toBe("fallback");
  });
});

describe("localError and ApiError", () => {
  it("builds a local error and carries detail through ApiError", () => {
    const detail = localError("Could not reach AI.");
    expect(detail.requestId).toBe("");
    const error = new ApiError(detail);
    expect(error.detail).toBe(detail);
    expect(error.message).toBe("Could not reach AI.");
  });
});

