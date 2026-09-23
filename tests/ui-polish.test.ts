import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgressDiff, ReplanDiff, progressNextAction } from "@/components/ai/ObjectAI";
import { deriveNextAction, COMPLETION_NEXT_ACTION } from "@/lib/objects/next-action";
import type { ManagedObject } from "@/lib/types/object";

const object: ManagedObject = {
  id: "object-uuid", title: "Install board", goal: "Organize equipment", status: "doing", position: 0, category: null, archivedAt: null, cancelledAt: null, currentState: "Position measured", nextAction: "Prepare screws", unresolvedDependencies: 0, recurrence: null, occurrenceNote: null,
  checklist: [
    { id: "uuid-completed", title: "Measure wall", completed: true, position: 0, parentId: null },
    { id: "uuid-current", title: "Prepare screws", completed: false, position: 1, parentId: null },
    { id: "uuid-last", title: "Mount board", completed: false, position: 2, parentId: null },
  ],
};
const progress = { currentState: "Screws prepared", nextAction: "Model suggestion", completedItemIds: ["uuid-current"], reopenedItemIds: [], newChecklistItems: [{ title: "Clean workspace", parentItemId: null }], summary: "Prepared screws." };
describe("Phase 9 review previews", () => {
  it("uses titles and resulting deterministic Next Action rather than raw IDs or model free text", () => {
    const html = renderToStaticMarkup(createElement(ProgressDiff, { object, update: progress }));
    expect(html).toContain("Prepare screws");
    expect(html).toContain("Clean workspace");
    expect(html).not.toContain("uuid-current");
    expect(html).not.toContain("Model suggestion");
    expect(progressNextAction(object, progress)).toBe("Mount board");
  });
  it("previews reopened work, empty and all-complete checklists with the shared rule", () => {
    expect(progressNextAction(object, { ...progress, reopenedItemIds: ["uuid-completed"] })).toBe("Measure wall");
    expect(deriveNextAction([])).toBe(COMPLETION_NEXT_ACTION);
    expect(deriveNextAction(object.checklist.map((item) => ({ ...item, completed: true })))).toBe(COMPLETION_NEXT_ACTION);
  });
  it("shows Title/Goal and old/new checklist diff without internal identifiers", () => {
    const proposal = {
      title: "Install clamp board", goal: "Organize without drilling", currentState: "Drilling is not allowed", reasonSummary: "Rental wall constraint", summary: "Changed mounting approach.",
      checklist: [
        { sourceItemId: "uuid-completed", title: "Measure wall", completed: true, changeType: "keep" as const, children: [] },
        { sourceItemId: "uuid-current", title: "Prepare desk clamps", completed: false, changeType: "modify" as const, children: [] },
        { sourceItemId: null, title: "Test clamp load", completed: false, changeType: "add" as const, children: [] },
      ], removedItemIds: ["uuid-last"],
    };
    const html = renderToStaticMarkup(createElement(ReplanDiff, { object, proposal }));
    for (const text of ["KEEP", "MODIFY", "ADD", "REMOVE", "Prepare screws", "Prepare desk clamps", "Install clamp board", "Organize equipment", "Organize without drilling", "Final checklist"]) expect(html).toContain(text);
    expect(html).not.toContain("uuid-");
  });
  it("safely presents stale IDs and multilingual/HTML-like content", () => {
    const html = renderToStaticMarkup(createElement(ProgressDiff, { object, update: { ...progress, completedItemIds: ["foreign-uuid"], currentState: "已完成 <script>alert(1)</script>" } }));
    expect(html).toContain("Checklist item no longer available");
    expect(html).not.toContain("foreign-uuid");
    expect(html).not.toContain("<script>");
    expect(html).toContain("已完成");
  });
});
