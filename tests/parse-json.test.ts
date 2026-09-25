import { describe, expect, it } from "vitest";
import { extractJSON } from "@/lib/ai/parse-json";

describe("extractJSON", () => {
  it("parses a bare JSON object", () => {
    expect(extractJSON('{"message":"hi","phase":"clarifying","draft":null}')).toEqual({
      message: "hi",
      phase: "clarifying",
      draft: null,
    });
  });

  it("parses a bare JSON array", () => {
    expect(extractJSON('["a","b"]')).toEqual(["a", "b"]);
  });

  it("tolerates surrounding whitespace", () => {
    expect(extractJSON('\n  {"ok":true}  \n')).toEqual({ ok: true });
  });

  it("strips a Markdown ```json fence", () => {
    const out = extractJSON('```json\n{"message":"hi","phase":"clarifying","draft":null}\n```');
    expect(out).toEqual({ message: "hi", phase: "clarifying", draft: null });
  });

  it("strips a fence with CRLF line endings", () => {
    const out = extractJSON('```json\r\n{"ok":true}\r\n```');
    expect(out).toEqual({ ok: true });
  });

  it("extracts the first JSON object embedded in prose", () => {
    const out = extractJSON(
      'Sure! Here is the plan:\n{"title":"Buy helmet","goal":"Purchase an MT Thunder 4 SV","checklist":[]}\nWould you like to adjust anything?',
    );
    expect(out).toEqual({
      title: "Buy helmet",
      goal: "Purchase an MT Thunder 4 SV",
      checklist: [],
    });
  });

  it("extracts the first JSON array embedded in prose", () => {
    expect(extractJSON('Result is [1, 2, 3] for you.')).toEqual([1, 2, 3]);
  });

  it("handles braces and brackets inside string values", () => {
    const out = extractJSON('{"message":"hello } world [x]","phase":"clarifying","draft":null} trailing');
    expect(out).toEqual({ message: "hello } world [x]", phase: "clarifying", draft: null });
  });

  it("handles nested objects and escaped quotes", () => {
    const out = extractJSON('{"a":{"b":[{"c":"say \\"hi\\" now"}]}}');
    expect(out).toEqual({ a: { b: [{ c: 'say "hi" now' }] } });
  });

  it("returns only the first JSON value when prose contains two", () => {
    const out = extractJSON('{"first":1} and {"second":2}');
    expect(out).toEqual({ first: 1 });
  });

  it("returns undefined for prose with no JSON", () => {
    expect(extractJSON("I'm sorry, I cannot help with that.")).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(extractJSON("")).toBeUndefined();
    expect(extractJSON("   ")).toBeUndefined();
  });

  it("returns undefined for a fenced block that is not JSON", () => {
    expect(extractJSON('```json\nnot json at all\n```')).toBeUndefined();
  });

  it("returns null for the literal JSON value null", () => {
    expect(extractJSON("null")).toBeNull();
  });
});
