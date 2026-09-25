import { describe, expect, it } from "vitest";
import { CREATE_OBJECT_SYSTEM_PROMPT } from "@/lib/ai/prompts";

/**
 * Prompt-only regression tests. These pin the behavioural guidance the AI
 * relies on so future edits cannot silently remove or weaken the Table,
 * candidate-row, carry-forward, over-generation or clarification rules.
 */
describe("AI create system prompt — Table behavior", () => {
  const prompt = CREATE_OBJECT_SYSTEM_PROMPT.toLowerCase();

  const contains = (phrase: string) => {
    expect(prompt).toContain(phrase.toLowerCase());
  };

  it("teaches proactive Table inference for structured recurring records", () => {
    contains("prefer a table when the object naturally manages multiple homogeneous structured records");
    contains("recurring maintenance");
    contains("recurring inspection");
    contains("inventory");
    contains("repeated measurements");
    contains("recurring expenses");
    contains("structured tracking");
  });

  it("guards against turning every recurring Object into a Table", () => {
    contains("do not turn every recurring object into a table");
    contains("recurrence alone is not a table signal");
    contains("pay car tax every year");
    contains("change my password every 6 months");
    contains("not merely whether it recurs");
  });

  it("teaches candidate tracking rows without claiming actions happened", () => {
    contains("populate useful candidate rows");
    contains("not that the item was already serviced");
  });

  it("teaches carry-forward semantics", () => {
    contains("stable item/category identity normally carries forward");
    contains("occurrence-specific results");
    contains("not a fixed template");
  });

  it("keeps the no-fabrication rule for factual cells", () => {
    contains("never invent whether an item was serviced");
    contains("exact service dates");
    contains("historical maintenance facts");
  });

  it("preserves the clarification rule for table population", () => {
    contains("do not ask extra questions merely to populate the table");
    contains("never ask for unknown mileage, costs, specifications or dates just to fill cells");
  });
});
