import { describe, expect, it } from "vitest";
import {
  chatResponseSchema,
  normalizeLegacyChatResponse,
} from "@/lib/ai/schemas";

describe("AI chat response schema", () => {
  it("accepts proposal checklist items as objects", () => {
    const result = chatResponseSchema.safeParse({
      message: "Ready.",
      phase: "proposal",
      draft: {
        title: "Make a table",
        goal: "Build a table",
        currentState: "Nothing built yet",
        nextAction: "Choose dimensions",
        checklist: [
          { title: "Choose dimensions", completed: false, position: 0 },
          { title: "Buy wood", completed: false, position: 1 },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it("normalizes only legacy string checklist items", () => {
    const normalized = normalizeLegacyChatResponse({
      message: "Ready.",
      phase: "proposal",
      draft: {
        title: "Make a table",
        goal: "Build a table",
        currentState: "Nothing built yet",
        nextAction: "Choose dimensions",
        checklist: ["Choose dimensions", "Buy wood"],
      },
    });

    expect(chatResponseSchema.parse(normalized).draft?.checklist).toEqual([
      { title: "Choose dimensions", completed: false, children: [] },
      { title: "Buy wood", completed: false, children: [] },
    ]);
  });

  it("wraps a flat draft returned without the message/phase/draft wrapper", () => {
    const normalized = normalizeLegacyChatResponse({
      title: "Buy MT Thunder 4 SV helmet",
      goal: "Purchase an MT Thunder 4 SV helmet",
      currentState: "Not purchased yet",
      nextAction: "Confirm size and color",
      suggestedCategoryName: null,
      checklist: [{ title: "Confirm size", completed: false, children: [] }],
    });

    const parsed = chatResponseSchema.parse(normalized);
    expect(parsed.phase).toBe("proposal");
    expect(parsed.draft?.title).toBe("Buy MT Thunder 4 SV helmet");
    expect(parsed.draft?.checklist).toEqual([
      { title: "Confirm size", completed: false, children: [] },
    ]);
  });

  it("wraps a flat draft whose checklist items are strings", () => {
    const normalized = normalizeLegacyChatResponse({
      title: "Buy helmet",
      goal: "Purchase a helmet",
      currentState: "Researching",
      nextAction: "Pick a model",
      checklist: ["Pick a model", "Check size"],
    });

    expect(chatResponseSchema.parse(normalized).draft?.checklist).toEqual([
      { title: "Pick a model", completed: false, children: [] },
      { title: "Check size", completed: false, children: [] },
    ]);
  });

  it("leaves a non-draft object unchanged", () => {
    expect(normalizeLegacyChatResponse({ unrelated: true })).toEqual({ unrelated: true });
  });
});
