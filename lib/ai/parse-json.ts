/**
 * Best-effort extraction of a JSON value from an AI provider's text output.
 *
 * Some OpenAI-compatible providers ignore the `json_schema` structured-output
 * request and instead return natural-language prose, or wrap the JSON in a
 * Markdown code fence. This helper makes parsing tolerant of those deviations
 * WITHOUT weakening validation: callers must still `safeParse` the extracted
 * value against their schema, so malformed or non-JSON input is never accepted.
 *
 * Returns `undefined` when no JSON value could be extracted (distinct from a
 * parsed `null`, which is a valid JSON value and returns `null`).
 */
export function extractJSON(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // 1. Direct parse (the happy path for providers that honor structured output).
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  // 2. Strip a Markdown code fence (```json ... ```) and retry.
  const fenced = stripCodeFence(trimmed);
  if (fenced !== trimmed) {
    try {
      return JSON.parse(fenced);
    } catch {
      // fall through
    }
  }

  // 3. Extract the first balanced JSON object/array embedded in prose.
  const embedded = extractFirstJSONValue(trimmed);
  if (embedded !== null) {
    try {
      return JSON.parse(embedded);
    } catch {
      // fall through
    }
  }

  return undefined;
}

function stripCodeFence(text: string): string {
  const match = text.match(/^```[a-zA-Z0-9_-]*\s*\r?\n([\s\S]*?)\r?\n?```\s*$/);
  return match ? match[1].trim() : text;
}

function extractFirstJSONValue(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start < 0) return null;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
