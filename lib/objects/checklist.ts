import type { ChecklistItem } from "@/lib/types/object";
import { withDerivedCompletion } from "./next-action";

/** Mirror database cascading deletion so hidden descendants cannot inflate progress. */
export function removeChecklistSubtree(items: ChecklistItem[], itemId: string): ChecklistItem[] {
  const children = new Map<string, string[]>();
  for (const item of items) {
    if (item.parentId == null) continue;
    const ids = children.get(item.parentId) ?? [];
    ids.push(item.id);
    children.set(item.parentId, ids);
  }
  const removed = new Set<string>();
  const pending = [itemId];
  while (pending.length) {
    const id = pending.pop()!;
    if (removed.has(id)) continue;
    removed.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return withDerivedCompletion(items.filter((item) => !removed.has(item.id)));
}
