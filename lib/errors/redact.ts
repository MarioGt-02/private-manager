/**
 * Centralized redaction/sanitization for client-visible debug info and server
 * logs. Never expose or log secret values.
 */

export const REDACTED = "[REDACTED]";

const SENSITIVE_TOKENS = [
  "authorization",
  "cookie",
  "apikey",
  "api-key",
  "api_key",
  "token",
  "secret",
  "password",
  "passwd",
  "database_url",
  "connection_string",
  "connectionstring",
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_TOKENS.some((token) => {
    const t = token.replace(/[^a-z0-9]/g, "");
    return normalized === t || normalized.includes(t);
  });
}

const MAX_DEPTH = 6;

/** Deep-redact object keys whose name implies a secret. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(record)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

export function truncate(value: string, max = 300): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated ${value.length - max} chars]`;
}

/**
 * Redact secrets embedded inside a single string, e.g. "key=value" pairs,
 * sk-* keys, Bearer tokens, and URL credentials.
 */
export function redactString(value: string): string {
  let out = value;
  // "key=value" / "key: value" pairs whose key looks sensitive.
  out = out.replace(
    /[A-Za-z0-9_-]*(?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*[^&\s,;]+/gi,
    (match) => {
      const sep = match.search(/[:=]/);
      return `${match.slice(0, sep + 1)}${REDACTED}`;
    },
  );
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{4,})\b/g, REDACTED);
  out = out.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+\b/gi, `$1${REDACTED}`);
  // Redact the password in a URL credential segment.
  out = out.replace(/[a-z][a-z0-9+.-]*:\/\/[^@\s]+@/gi, (match) => {
    const at = match.lastIndexOf("@");
    const colon = match.indexOf(":", match.indexOf("://") + 3);
    if (colon >= 0 && colon < at) {
      return `${match.slice(0, colon + 1)}${REDACTED}${match.slice(at)}`;
    }
    return match;
  });
  return out;
}

/** Safe, bounded summary of an unknown error (never a raw Error object). */
export function summarizeError(error: unknown, max = 300): string {
  if (error instanceof Error) return truncate(error.message || error.name, max);
  if (typeof error === "string") return truncate(error, max);
  try {
    return truncate(JSON.stringify(redact(error)), max);
  } catch {
    return "Unknown error";
  }
}
