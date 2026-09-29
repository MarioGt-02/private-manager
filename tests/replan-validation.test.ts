import { describe, expect, it } from "vitest";
import { prepareReplanProposal, validateReplanProposal, ReplanValidationError } from "@/lib/ai/replan-validation";
import type { ChecklistItem } from "@/lib/types/object";

const existing: ChecklistItem[] = [
  { id: "parent", title: "Parent", parentId: null, completed: true, position: 0 },
  { id: "child", title: "Child", parentId: "parent", completed: true, position: 0 },
  { id: "other", title: "Other", parentId: null, completed: false, position: 1 },
];
const item = (id: string | null) => ({ sourceItemId: id, title: "Plan item", completed: false, changeType: "keep" as const, children: [] });

describe("Replan proposal validation", () => {
  it("preserves omitted parent/child IDs and completion before preview without mutation", () => {
    const input = { checklist: [item("other")], removedItemIds: [] };
    const before = structuredClone({ input, existing });
    const prepared = prepareReplanProposal(input, existing);
    expect(prepared.checklist[1]).toMatchObject({ sourceItemId: "parent", completed: true });
    expect(prepared.checklist[1].children[0]).toMatchObject({ sourceItemId: "child", completed: true });
    expect({ input, existing }).toEqual(before);
    expect(() => validateReplanProposal(prepared, existing)).not.toThrow();
  });

  it("rejects unknown IDs and duplicates rather than inventing a mapping", () => {
    expect(() => prepareReplanProposal({ checklist: [item("wrong-id")], removedItemIds: [] }, existing)).toThrow("IDs that do not exist");
    expect(() => prepareReplanProposal({ checklist: [item("parent"), item("parent")], removedItemIds: [] }, existing)).toThrow("more than once");
    expect(() => prepareReplanProposal({ checklist: [item("other")], removedItemIds: ["parent", "parent"] }, existing)).toThrow("more than once");
  });

  it("rejects keep/remove overlap including a removed parent's children", () => {
    expect(() => prepareReplanProposal({ checklist: [item("child")], removedItemIds: ["parent"] }, existing)).toThrow("both keeps and removes");
  });

  it("requires every current item to be accounted for at apply time", () => {
    expect(() => validateReplanProposal({ checklist: [item("other")], removedItemIds: [] }, existing)).toThrow("incomplete AI proposal");
  });

  it("still rejects a stale preview when a new checklist item appears after analyze", () => {
    const prepared = prepareReplanProposal({ checklist: [item("other")], removedItemIds: [] }, existing);
    const changed = [...existing, { id: "new-after-preview", title: "New work", parentId: null, completed: false, position: 2 }];
    expect(() => validateReplanProposal(prepared, changed)).toThrow("does not account for every existing checklist item");
  });

  it("does not preserve children of explicitly removed parents", () => {
    const prepared = prepareReplanProposal({ checklist: [item("other")], removedItemIds: ["parent"] }, existing);
    expect(prepared.checklist).toHaveLength(1);
  });

  it("rejects demoting a parent when its children have been omitted", () => {
    const input = { checklist: [{ ...item(null), children: [{ sourceItemId: "parent", title: "Parent", completed: true, changeType: "modify" as const }] }], removedItemIds: [] };
    expect(() => prepareReplanProposal(input, existing)).toThrow(ReplanValidationError);
    expect(() => prepareReplanProposal(input, existing)).toThrow("omits its children");
  });
});