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
});
