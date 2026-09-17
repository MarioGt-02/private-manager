import type { ChecklistItem } from "@/lib/types/object";

export const COMPLETION_NEXT_ACTION = "检查并将对象标记为已完成。";

export type NextActionItem = Pick<ChecklistItem, "title" | "completed" | "position"> &
  Partial<Pick<ChecklistItem, "id" | "parentId">>;

/**
 * The first unfinished actionable leaf in document order (top-level items by
 * position, then each parent's children by position). A parent with children is
 * not itself actionable — its first unfinished child is.
 *
 * This is the single source of truth for the card's quick-complete target.
 */
export function getFirstActionableIncompleteLeaf(items: NextActionItem[]): NextActionItem | null {
  const top = items
    .filter((item) => item.parentId == null)
    .sort((a, b) => a.position - b.position);

  for (const parent of top) {
    const children = items
      .filter((item) => item.parentId != null && item.parentId === parent.id)
      .sort((a, b) => a.position - b.position);

    if (children.length > 0) {
      for (const child of children) {
        if (!child.completed) return child;
      }
    } else if (!parent.completed) {
      return parent;
    }
  }

  return null;
}

export function deriveNextAction(items: NextActionItem[]): string {
  return getFirstActionableIncompleteLeaf(items)?.title ?? COMPLETION_NEXT_ACTION;
}

/** Sort a flat checklist into document order (each parent immediately followed by its children). */
export function sortChecklist(items: ChecklistItem[]): ChecklistItem[] {
  const top = items
    .filter((item) => item.parentId == null)
    .sort((a, b) => a.position - b.position);

  const childrenByParent = new Map<string, ChecklistItem[]>();
  for (const item of items) {
    if (item.parentId == null) continue;
    const list = childrenByParent.get(item.parentId) ?? [];
    list.push(item);
    childrenByParent.set(item.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.position - b.position);
  }

  const result: ChecklistItem[] = [];
  for (const parent of top) {
    result.push(parent);
    result.push(...(childrenByParent.get(parent.id) ?? []));
  }
  return result;
}

/** Derive parent completion from children: complete only when all children complete. */
export function withDerivedCompletion(items: ChecklistItem[]): ChecklistItem[] {
  const totals = new Map<string, number>();
  const done = new Map<string, number>();
  for (const item of items) {
    if (item.parentId == null) continue;
    totals.set(item.parentId, (totals.get(item.parentId) ?? 0) + 1);
    if (item.completed) done.set(item.parentId, (done.get(item.parentId) ?? 0) + 1);
  }
  return items.map((item) => {
    const total = totals.get(item.id);
    if (total != null && total > 0) {
      return { ...item, completed: done.get(item.id) === total };
    }
    return item;
  });
}

/** Build a one-level nested tree (parent → children) for AI model context. */
export function buildChecklistTree(items: ChecklistItem[]) {
  const top = items
    .filter((item) => item.parentId == null)
    .sort((a, b) => a.position - b.position);
  const childrenOf = (id: string) =>
    items
      .filter((item) => item.parentId === id)
      .sort((a, b) => a.position - b.position);

  return top.map((parent) => ({
    id: parent.id,
    title: parent.title,
    completed: parent.completed,
    children: childrenOf(parent.id).map((child) => ({
      id: child.id,
      title: child.title,
      completed: child.completed,
    })),
  }));
}
