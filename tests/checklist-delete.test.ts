import { describe, expect, it } from "vitest";
import { removeChecklistSubtree } from "@/lib/objects/checklist";
import { deriveNextAction } from "@/lib/objects/next-action";
import type { ChecklistItem } from "@/lib/types/object";
const item = (id: string, parentId: string | null = null, completed = false, position = 0): ChecklistItem => ({ id, title: id, parentId, completed, position });
describe("Checklist deletion progress", () => {
  it("removes hidden children as well as the deleted parent, leaving the actual 1/7 progress", () => {
    const kept = Array.from({ length: 7 }, (_, i) => item(`kept-${i}`, null, i === 6, i + 1));
    const before = [item("deleted-parent"), ...Array.from({ length: 11 }, (_, i) => item(`deleted-child-${i}`, "deleted-parent", false, i)), ...kept];
    expect(before).toHaveLength(19);
    // The previous single-row filter left 18 records but only seven renderable rows.
    expect(before.filter((row) => row.id !== "deleted-parent")).toHaveLength(18);
    const remaining = removeChecklistSubtree(before, "deleted-parent");
    expect(remaining).toEqual(kept);
    expect(remaining.filter((row) => row.completed)).toHaveLength(1);
    expect(deriveNextAction(remaining)).toBe("kept-0");
    expect(before).toHaveLength(19);
  });
  it("recomputes surviving parent completion when its last incomplete child is removed", () => {
    const remaining = removeChecklistSubtree([item("parent"), item("done", "parent", true), item("unfinished", "parent")], "unfinished");
    expect(remaining.find((row) => row.id === "parent")?.completed).toBe(true);
    expect(remaining.filter((row) => row.completed)).toHaveLength(2);
  });
  it("removes deeper descendants without deleting unrelated items or looping on malformed cycles", () => {
    expect(removeChecklistSubtree([item("p"), item("c", "p"), item("g", "c"), item("unrelated")], "p").map((row) => row.id)).toEqual(["unrelated"]);
    expect(removeChecklistSubtree([item("a", "b"), item("b", "a"), item("unrelated")], "a").map((row) => row.id)).toEqual(["unrelated"]);
  });
});
