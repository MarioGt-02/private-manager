import { describe, expect, it } from "vitest";
import type { ManagedObject } from "@/lib/types/object";
import { filterObjectsByCategory, type CategoryFilterValue } from "@/lib/categories/filter";
import { reorderBoardObjects } from "@/lib/objects/board-order";
import { filterObjectsBySearch, isEditableSearchTarget, matchesObjectSearch, normalizeSearchText, shouldClearObjectSearch, shouldFocusObjectSearch } from "@/lib/objects/search";

function object(id: string, categoryId: string | null, text: Partial<ManagedObject> = {}): ManagedObject {
  return {
    id, title: text.title ?? id, status: "doing", position: 0, category: null, categoryId,
    archivedAt: null, cancelledAt: null, goal: text.goal ?? "", currentState: text.currentState ?? "",
    nextAction: text.nextAction ?? "", checklist: text.checklist ?? [], unresolvedDependencies: 0,
    recurrence: null, occurrenceNote: text.occurrenceNote ?? null,
  };
}

const audi = object("audi", "vehicles", {
  title: "Audi A3",
  goal: "每年完成车辆保养",
  currentState: "已完成检查",
  nextAction: "安排下次保养",
  occurrenceNote: "Filtro italiano",
  checklist: [
    { id: "parent", parentId: null, title: "检查车辆", completed: false, position: 0 },
    { id: "child", parentId: "parent", title: "Oil Filter", completed: false, position: 1 },
  ],
});

describe("Object search", () => {
  it("matches an empty query and searches every Board field", () => {
    expect(matchesObjectSearch(audi, "")).toBe(true);
    for (const query of ["Audi", "车辆", "已完成", "保养", "检查车辆", "Oil Filter", "Filtro italiano"]) {
      expect(matchesObjectSearch(audi, query)).toBe(true);
    }
  });

  it("normalizes case, Unicode width and whitespace", () => {
    expect(normalizeSearchText("  Ａｕｄｉ\tA3  ")).toBe("audi a3");
    expect(matchesObjectSearch(audi, "  AUDI   保养 ")).toBe(true);
  });

  it("uses AND semantics across fields and excludes unmatched terms", () => {
    expect(matchesObjectSearch(audi, "Audi 保养")).toBe(true);
    expect(matchesObjectSearch(audi, "Audi missing")).toBe(false);
    expect(filterObjectsBySearch([audi], "missing")).toEqual([]);
  });

  it("composes Category AND Search without changing source data", () => {
    const maker = object("maker", "maker", { title: "Audi workshop" });
    const source = [audi, maker];
    const category: CategoryFilterValue = { mode: "selected", categoryIds: ["vehicles"], includeUncategorized: false };
    const before = structuredClone(source);
    expect(filterObjectsBySearch(filterObjectsByCategory(source, category), "Audi").map((item) => item.id)).toEqual(["audi"]);
    expect(source).toEqual(before);
  });

  it("keeps all five status columns conceptually available when search has no matches", () => {
    expect(filterObjectsBySearch([audi], "no-match")).toHaveLength(0);
  });

  it("preserves hidden objects when category and search filters are used for reorder", () => {
    const hiddenCategory = object("hidden-category", "maker");
    const hiddenSearch = object("hidden-search", "vehicles", { title: "Other" });
    const visible = object("visible", "vehicles", { title: "Audi" });
    const all = [visible, hiddenCategory, hiddenSearch];
    const visibleIds = new Set(filterObjectsBySearch(filterObjectsByCategory(all, { mode: "selected", categoryIds: ["vehicles"], includeUncategorized: false }), "Audi").map((item) => item.id));
    const reordered = reorderBoardObjects(all, "visible", "ready", null, false, visibleIds)!;
    expect(reordered.objects.find((item) => item.id === "hidden-category")?.categoryId).toBe("maker");
    expect(reordered.objects.find((item) => item.id === "hidden-search")?.title).toBe("Other");
  });

  it("preserves hidden ordering and moved status across filtered columns", () => {
    const moving = object("moving", "vehicles", { title: "Audi" });
    moving.status = "doing";
    const hiddenDoing = object("hidden-doing", "maker", { title: "Other" });
    const ready = object("ready", "vehicles", { title: "Audi ready" });
    ready.status = "ready";
    const all = [moving, hiddenDoing, ready];
    const visibleIds = new Set(["moving", "ready"]);
    const reordered = reorderBoardObjects(all, "moving", "ready", "ready", false, visibleIds)!;
    expect(reordered.objects.find((item) => item.id === "moving")).toMatchObject({ status: "ready" });
    expect(reordered.objects.find((item) => item.id === "hidden-doing")).toMatchObject({ status: "doing", title: "Other" });
    expect(reordered.objects.map((item) => item.id)).toEqual(["moving", "ready", "hidden-doing"]);
  });

  it("identifies editable targets so slash does not steal focus", () => {
    expect(isEditableSearchTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableSearchTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isEditableSearchTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isEditableSearchTarget({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
    expect(shouldFocusObjectSearch("/", { tagName: "BUTTON" } as unknown as EventTarget)).toBe(true);
    expect(shouldFocusObjectSearch("/", { tagName: "INPUT" } as unknown as EventTarget)).toBe(false);
    const dialogButton = { closest: (selector: string) => selector.includes("role") ? {} : null } as unknown as EventTarget;
    expect(shouldFocusObjectSearch("/", dialogButton)).toBe(false);
    expect(shouldClearObjectSearch("Escape", "Audi")).toBe(true);
    expect(shouldClearObjectSearch("Escape", "")).toBe(false);
  });
});