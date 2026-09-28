import type { Category } from "./model";
import type { ManagedObject } from "@/lib/types/object";

export const CATEGORY_FILTER_STORAGE_KEY = "private-manager:board-category-filter";

export type CategoryFilterValue =
  | { mode: "all" }
  | { mode: "selected"; categoryIds: string[]; includeUncategorized: boolean };

export function allCategoryFilter(): CategoryFilterValue {
  return { mode: "all" };
}

export function sanitizeCategoryFilter(value: unknown, categories: Category[]): CategoryFilterValue {
  if (!value || typeof value !== "object") return allCategoryFilter();
  const candidate = value as Record<string, unknown>;
  if (candidate.mode === "all") return allCategoryFilter();
  if (candidate.mode !== "selected" || !Array.isArray(candidate.categoryIds)) return allCategoryFilter();

  const validIds = new Set(categories.map((category) => category.id));
  const categoryIds = [...new Set(candidate.categoryIds.filter((id): id is string => typeof id === "string" && validIds.has(id)))];
  const includeUncategorized = candidate.includeUncategorized === true;
  return categoryIds.length || includeUncategorized
    ? { mode: "selected", categoryIds, includeUncategorized }
    : allCategoryFilter();
}

export function parseStoredCategoryFilter(raw: string | null, categories: Category[]): CategoryFilterValue {
  if (!raw) return allCategoryFilter();
  try {
    return sanitizeCategoryFilter(JSON.parse(raw), categories);
  } catch {
    return allCategoryFilter();
  }
}

export function categoryMatchesFilter(object: Pick<ManagedObject, "categoryId">, filter: CategoryFilterValue): boolean {
  if (filter.mode === "all") return true;
  return object.categoryId == null
    ? filter.includeUncategorized
    : filter.categoryIds.includes(object.categoryId);
}

export function filterObjectsByCategory(objects: ManagedObject[], filter: CategoryFilterValue): ManagedObject[] {
  return objects.filter((object) => categoryMatchesFilter(object, filter));
}

export function categoryFilterLabel(filter: CategoryFilterValue, categories: Category[]): string {
  if (filter.mode === "all") return "All";
  const count = filter.categoryIds.length + (filter.includeUncategorized ? 1 : 0);
  if (count > 1) return `${count} selected`;
  if (filter.includeUncategorized) return "No category";
  const firstId = filter.categoryIds[0];
  return firstId ? (categories.find((category) => category.id === firstId)?.name ?? "All") : "All";
}