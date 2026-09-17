import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COMPLETION_NEXT_ACTION, deriveNextAction, getFirstActionableIncompleteLeaf } from "@/lib/objects/next-action";
import { CardBody } from "@/components/board/ObjectCard";
import type { ChecklistItem, ManagedObject } from "@/lib/types/object";

const item = (id: string, title: string, completed = false, parentId: string | null = null, position = 0): ChecklistItem => ({ id, parentId, title, completed, position });
const obj = (checklist: ChecklistItem[], nextAction: string): ManagedObject => ({ id: "o1", title: "Title", status: "doing", position: 0, category: null, categoryId: null, archivedAt: null, cancelledAt: null, goal: "Goal", currentState: "Current", nextAction, checklist });

describe("getFirstActionableIncompleteLeaf", () => {
  it("returns the first unfinished flat leaf by id", () => {
    expect(getFirstActionableIncompleteLeaf([item("a", "A"), item("b", "B")])?.id).toBe("a");
  });

  it("returns the first unfinished child leaf and skips a completed parent", () => {
    const items = [item("p", "Parent", true), item("c1", "Child A", true, "p", 0), item("c2", "Child B", false, "p", 1)];
    expect(getFirstActionableIncompleteLeaf(items)?.id).toBe("c2");
  });

  it("never returns a parent while children remain unfinished", () => {
    const items = [item("p", "Parent", false), item("c1", "Child A", false, "p", 0)];
    expect(getFirstActionableIncompleteLeaf(items)?.id).toBe("c1");
  });

  it("returns null when everything is complete", () => {
    expect(getFirstActionableIncompleteLeaf([item("a", "A", true), item("b", "B", true)])).toBeNull();
  });

  it("returns null for an empty checklist", () => {
    expect(getFirstActionableIncompleteLeaf([])).toBeNull();
  });

  it("resolves duplicate titles by id, not text", () => {
    expect(getFirstActionableIncompleteLeaf([item("a", "Same"), item("b", "Same")])?.id).toBe("a");
  });

  it("deriveNextAction uses the same leaf and the shared fallback", () => {
    expect(deriveNextAction([item("a", "A")])).toBe("A");
    expect(deriveNextAction([item("a", "A", true)])).toBe(COMPLETION_NEXT_ACTION);
  });
});

describe("Card quick-complete checkbox", () => {
  it("shows the checkbox when Next Action resolves to an unfinished leaf", () => {
    const html = renderToStaticMarkup(createElement(CardBody, { object: obj([item("a", "Test restore")], "Test restore"), onCompleteNextAction: vi.fn() }));
    expect(html).toContain('Mark &quot;Test restore&quot; complete');
    expect(html).toContain("Test restore");
  });

  it("hides the checkbox for the completion fallback", () => {
    const html = renderToStaticMarkup(createElement(CardBody, { object: obj([item("a", "A", true)], COMPLETION_NEXT_ACTION), onCompleteNextAction: vi.fn() }));
    expect(html).not.toContain('Mark &quot;');
  });

  it("hides the checkbox for a manually authored Next Action", () => {
    const html = renderToStaticMarkup(createElement(CardBody, { object: obj([item("a", "A", false)], "Call garage tomorrow"), onCompleteNextAction: vi.fn() }));
    expect(html).not.toContain('Mark &quot;');
    expect(html).toContain("Call garage tomorrow");
  });

  it("hides the checkbox when no handler is provided (drag overlay)", () => {
    const html = renderToStaticMarkup(createElement(CardBody, { object: obj([item("a", "A", false)], "A") }));
    expect(html).not.toContain('Mark &quot;');
    expect(html).toContain("A");
  });
});
