import { describe, expect, it } from "vitest";
import { prepareReplanProposal, repairReplanSourceIds, validateReplanProposal, ReplanValidationError } from "@/lib/ai/replan-validation";
import type { ChecklistItem } from "@/lib/types/object";
import { explicitTableRequestTitle, replanProposalSchema } from "@/lib/ai/replan";

const existing: ChecklistItem[] = [
  { id: "parent", title: "Parent", parentId: null, completed: true, position: 0 },
  { id: "child", title: "Child", parentId: "parent", completed: true, position: 0 },
  { id: "other", title: "Other", parentId: null, completed: false, position: 1 },
];
const item = (id: string | null) => ({ sourceItemId: id, title: "Plan item", completed: false, changeType: "keep" as const, children: [] });

describe("Replan proposal validation", () => {
  it("recognizes only the explicit named-table command, not mixed changes or mentions", () => {
    expect(explicitTableRequestTitle("新增表格：电脑部件检查表格")).toBe("电脑部件检查表格");
    expect(explicitTableRequestTitle("Add table: Parts")).toBe("Parts");
    for (const text of ["新增表格：Parts，并修改计划", "新增表格：Parts 并且修改计划", "已经新增表格：Parts", "使用电脑部件检查表格完成检查", "新增表格："]) expect(explicitTableRequestTitle(text)).toBeNull();
  });

  it("allows an empty factual state for table-only previews but not legacy replans", () => {
    const base = { title: null, goal: null, currentState: "", reasonSummary: "Add records", checklistMode: "preserve", checklist: [], removedItemIds: [], summary: "Proposed table" };
    expect(replanProposalSchema.safeParse(base).success).toBe(true);
    expect(replanProposalSchema.safeParse({ ...base, checklistMode: "replan", checklist: [item(null)] }).success).toBe(false);
  });
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

  it("repairs an unknown source ID only when the old title is unique", () => {
    const repaired = repairReplanSourceIds({ checklist: [{ ...item("wrong-id"), title: "Other" }], removedItemIds: [] }, existing);
    expect(repaired.checklist[0].sourceItemId).toBe("other");
    const ambiguous = [...existing, { id: "other-2", title: "Other", parentId: null, completed: false, position: 3 }];
    expect(repairReplanSourceIds({ checklist: [{ ...item("wrong-id"), title: "Other" }], removedItemIds: [] }, ambiguous).checklist[0].sourceItemId).toBe("wrong-id");
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