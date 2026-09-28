import type { ManagedObject } from "@/lib/types/object";

/** Normalize user/object text without locale-dependent or fuzzy matching. */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function searchTokens(query: string): string[] {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(" ") : [];
}

export function searchableObjectText(object: Pick<ManagedObject, "title" | "goal" | "currentState" | "nextAction" | "checklist" | "occurrenceNote">): string {
  return normalizeSearchText([
    object.title,
    object.goal,
    object.currentState,
    object.nextAction,
    object.occurrenceNote ?? "",
    ...object.checklist.map((item) => item.title),
  ].join(" "));
}

export function matchesObjectSearch(object: ManagedObject, query: string): boolean {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const text = searchableObjectText(object);
  return tokens.every((token) => text.includes(token));
}

export function filterObjectsBySearch(objects: ManagedObject[], query: string): ManagedObject[] {
  return objects.filter((object) => matchesObjectSearch(object, query));
}

export function isEditableSearchTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: string; isContentEditable?: boolean };
  return element.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName ?? "");
}

export function shouldFocusObjectSearch(key: string, target: EventTarget | null): boolean {
  if (key !== "/" || isEditableSearchTarget(target)) return false;
  if (target && typeof target === "object") {
    const closest = (target as { closest?: (selector: string) => unknown }).closest;
    if (typeof closest === "function" && closest.call(target, '[role="dialog"], [aria-modal="true"], dialog[open]')) return false;
  }
  return true;
}

export function shouldClearObjectSearch(key: string, query: string): boolean {
  return key === "Escape" && query.length > 0;
}