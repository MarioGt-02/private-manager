import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Column } from "@/components/board/Column";
import { CategoryFilter } from "@/components/board/CategoryFilter";
import { CategoryQuickFilterBar } from "@/components/board/CategoryQuickFilterBar";
import { COLUMNS, type ManagedObject } from "@/lib/types/object";
import {
  allCategoryFilter,
  applyQuickCategoryFilterClick,
  categoryFilterLabel,
  filterObjectsByCategory,
  parseStoredCategoryFilter,
  sanitizeCategoryFilter,
  type CategoryFilterValue,
} from "@/lib/categories/filter";
import { reorderBoardObjects } from "@/lib/objects/board-order";
import type { Category } from "@/lib/categories/model";

const categories: Category[] = [
  { id: "vehicles", name: "Vehicles", color: "amber", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "maker", name: "Maker & DIY", color: "orange", createdAt: "2026-01-01T00:00:00.000Z" },
];

function object(id: string, categoryId: string | null, status: ManagedObject["status"] = "doing"): ManagedObject {
  return {
    id, title: id, status, position: 0, category: null, categoryId, archivedAt: null, cancelledAt: null,
    goal: "", currentState: "", nextAction: "", checklist: [], unresolvedDependencies: 0,
    recurrence: null, occurrenceNote: null,
  };
}

const source = [object("vehicle", "vehicles"), object("maker", "maker"), object("none", null)];

describe("Board category filter", () => {
  it("defaults All to every Object", () => {
    expect(filterObjectsByCategory(source, allCategoryFilter()).map((item) => item.id)).toEqual(["vehicle", "maker", "none"]);
  });

  it("selects one category", () => {
    expect(filterObjectsByCategory(source, { mode: "selected", categoryIds: ["vehicles"], includeUncategorized: false }).map((item) => item.id)).toEqual(["vehicle"]);
  });

  it("uses OR semantics for multiple categories", () => {
    expect(filterObjectsByCategory(source, { mode: "selected", categoryIds: ["vehicles", "maker"], includeUncategorized: false }).map((item) => item.id)).toEqual(["vehicle", "maker"]);
  });

  it("matches No category by null categoryId", () => {
    expect(filterObjectsByCategory(source, { mode: "selected", categoryIds: [], includeUncategorized: true }).map((item) => item.id)).toEqual(["none"]);
  });

  it("combines a category with No category", () => {
    expect(filterObjectsByCategory(source, { mode: "selected", categoryIds: ["vehicles"], includeUncategorized: true }).map((item) => item.id)).toEqual(["vehicle", "none"]);
  });

  it("sanitizes an empty selection to All and labels selections clearly", () => {
    expect(sanitizeCategoryFilter({ mode: "selected", categoryIds: [], includeUncategorized: false }, categories)).toEqual({ mode: "all" });
    expect(categoryFilterLabel({ mode: "selected", categoryIds: ["vehicles", "maker"], includeUncategorized: false }, categories)).toBe("2 selected");
    expect(categoryFilterLabel({ mode: "selected", categoryIds: [], includeUncategorized: true }, categories)).toBe("No category");
  });

  it("restores valid localStorage data and ignores deleted category IDs", () => {
    const saved = JSON.stringify({ mode: "selected", categoryIds: ["deleted", "vehicles"], includeUncategorized: true });
    expect(parseStoredCategoryFilter(saved, categories)).toEqual({ mode: "selected", categoryIds: ["vehicles"], includeUncategorized: true });
  });

  it("falls back to All for invalid saved data", () => {
    expect(parseStoredCategoryFilter("not-json", categories)).toEqual({ mode: "all" });
    expect(parseStoredCategoryFilter(JSON.stringify({ mode: "selected", categoryIds: ["deleted"], includeUncategorized: false }), categories)).toEqual({ mode: "all" });
    expect(parseStoredCategoryFilter(JSON.stringify({ wrong: true }), categories)).toEqual({ mode: "all" });
  });

  it("lets an Object disappear after a category change without mutating data", () => {
    const filter: CategoryFilterValue = { mode: "selected", categoryIds: ["vehicles"], includeUncategorized: false };
    const before = structuredClone(source);
    const changed = source.map((item) => item.id === "vehicle" ? { ...item, categoryId: "maker" } : item);
    expect(filterObjectsByCategory(changed, filter)).toEqual([]);
    expect(source).toEqual(before);
  });

  it("keeps a filtered empty column rendered", () => {
    const markup = renderToStaticMarkup(createElement(Column, {
      column: COLUMNS.find((item) => item.id === "done")!, objects: [], minimizedIds: new Set<string>(), pendingIds: new Set<string>(),
      onArchive: () => {}, onSelect: () => {}, onToggleMinimize: () => {}, onCompleteNextAction: () => {},
    }));
    expect(markup).toContain("Done");
    expect(markup).toContain("No Objects here yet.");
  });

  it("does not mutate the source array while filtering", () => {
    const before = [...source];
    const result = filterObjectsByCategory(source, { mode: "selected", categoryIds: ["vehicles"], includeUncategorized: false });
    expect(result).not.toBe(source);
    expect(source).toEqual(before);
  });

  it("renders an accessible multi-select control with categories and No category", () => {
    const markup = renderToStaticMarkup(createElement(CategoryFilter, { categories, value: { mode: "all" }, onChange: () => {} }));
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Category: All");
    expect(markup).not.toContain("Vehicles");
  });

  it("uses the compact label and keeps the clear action available for an active selection", () => {
    const markup = renderToStaticMarkup(createElement(CategoryFilter, { categories, value: { mode: "selected", categoryIds: ["vehicles"], includeUncategorized: true }, onChange: () => {} }));
    expect(markup).toContain("Category: 2 selected");
    expect(markup).not.toContain("Filter categories");
  });

  it("renders the quick filter bar with shared active state and accessible buttons", () => {
    const markup = renderToStaticMarkup(createElement(CategoryQuickFilterBar, { categories, value: { mode: "selected", categoryIds: ["vehicles", "maker"], includeUncategorized: true }, onChange: () => {} }));
    expect(markup).toContain('aria-label="Quick category filter"');
    expect(markup).toContain('aria-label="Vehicles"');
    expect(markup).toContain('aria-label="Maker &amp; DIY"');
    expect(markup).toContain('aria-label="No category"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain(">All</button>");
  });

  it("applies solo, toggle-All, modifier-add/remove and No category quick clicks", () => {
    const all = allCategoryFilter();
    const vehicles = applyQuickCategoryFilterClick(all, "vehicles", false);
    expect(vehicles).toEqual({ mode: "selected", categoryIds: ["vehicles"], includeUncategorized: false });
    expect(applyQuickCategoryFilterClick(vehicles, "vehicles", false)).toEqual(all);
    expect(applyQuickCategoryFilterClick(vehicles, "maker", false)).toEqual({ mode: "selected", categoryIds: ["maker"], includeUncategorized: false });
    const multi = applyQuickCategoryFilterClick(vehicles, "maker", true);
    expect(multi).toEqual({ mode: "selected", categoryIds: ["vehicles", "maker"], includeUncategorized: false });
    expect(applyQuickCategoryFilterClick(multi, "vehicles", true)).toEqual({ mode: "selected", categoryIds: ["maker"], includeUncategorized: false });
    expect(applyQuickCategoryFilterClick({ mode: "selected", categoryIds: ["maker"], includeUncategorized: false }, "maker", true)).toEqual(all);
    const none = applyQuickCategoryFilterClick(all, null, false);
    expect(none).toEqual({ mode: "selected", categoryIds: [], includeUncategorized: true });
    expect(applyQuickCategoryFilterClick(none, null, false)).toEqual(all);
    expect(applyQuickCategoryFilterClick(vehicles, null, true)).toEqual({ mode: "selected", categoryIds: ["vehicles"], includeUncategorized: true });
    expect(applyQuickCategoryFilterClick({ mode: "selected", categoryIds: [], includeUncategorized: true }, null, true)).toEqual(all);
  });

  it("preserves hidden card order when reordering a filtered view", () => {
    const all = [object("visible-a", "vehicles", "ready"), object("hidden-a", "maker", "ready"), object("hidden-b", null, "ready"), object("visible-b", "vehicles", "ready")];
    const beforeHidden = all.filter((item) => item.categoryId !== "vehicles").map((item) => item.id);
    const visibleIds = new Set(["visible-a", "visible-b"]);
    const reordered = reorderBoardObjects(all, "visible-b", "ready", "visible-a", false, visibleIds)!;
    expect(reordered.orderedObjectIds).toEqual(["visible-b", "hidden-a", "hidden-b", "visible-a"]);
    expect(reordered.objects.filter((item) => item.categoryId !== "vehicles").map((item) => item.id)).toEqual(beforeHidden);
    expect(all.map((item) => item.id)).toEqual(["visible-a", "hidden-a", "hidden-b", "visible-b"]);
  });

  it("preserves hidden cards and status on a cross-column drag", () => {
    const all = [object("visible", "vehicles", "doing"), object("hidden", "maker", "doing"), object("ready", null, "ready")];
    const reordered = reorderBoardObjects(all, "visible", "ready", null, false, new Set(["visible", "ready"]))!;
    expect(reordered.objects.find((item) => item.id === "visible")).toMatchObject({ status: "ready" });
    expect(reordered.objects.find((item) => item.id === "hidden")).toMatchObject({ status: "doing", categoryId: "maker" });
    expect(reordered.objects.find((item) => item.id === "ready")).toMatchObject({ status: "ready" });
  });

  it("keeps the unfiltered reorder contract unchanged", () => {
    const all = [object("a", "vehicles", "ready"), object("b", "maker", "ready"), object("c", null, "ready")];
    const reordered = reorderBoardObjects(all, "a", "ready", "b", true)!;
    expect(reordered.orderedObjectIds).toEqual(["b", "a", "c"]);
    expect(reordered.objects.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});