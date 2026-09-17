import { stringify } from "csv-stringify/sync";
import type { objects, checklistItems, objectUpdates, categories } from "@/lib/db/schema";
export interface ExportRows {
  categories: (typeof categories.$inferSelect)[];
  objects: (typeof objects.$inferSelect)[];
  checklistItems: (typeof checklistItems.$inferSelect)[];
  objectUpdates: (typeof objectUpdates.$inferSelect)[];
}
/** Explicit field allowlist: runtime environment and connection options cannot be exported. */
export function buildJSONExport(rows: ExportRows, now = new Date()) {
  return {
    format: "private-manager-export" as const, version: 1 as const, exportedAt: now.toISOString(),
    categories: rows.categories.map((row) => ({ id: row.id, name: row.name, color: row.color, createdAt: row.createdAt.toISOString() })),
    objects: rows.objects.map((row) => ({ id: row.id, title: row.title, category: row.category ?? null, categoryId: row.categoryId ?? null, status: row.status, position: row.position, goal: row.goal, currentState: row.currentState, nextAction: row.nextAction, archivedAt: row.archivedAt?.toISOString() ?? null, cancelledAt: row.cancelledAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })),
    checklistItems: rows.checklistItems.map((row) => ({ id: row.id, objectId: row.objectId, title: row.title, completed: row.completed, position: row.position, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })),
    objectUpdates: rows.objectUpdates.map((row) => ({ id: row.id, objectId: row.objectId, type: row.type, content: row.content, createdAt: row.createdAt.toISOString() })),
  };
}
export function buildCSVExport(rows: ExportRows) {
  const data = buildJSONExport(rows);
  const byObject = new Map<string, typeof data.checklistItems>();
  for (const item of data.checklistItems) { const items = byObject.get(item.objectId) ?? []; items.push(item); byObject.set(item.objectId, items); }
  const records = data.objects.map((object) => {
    const category = data.categories.find((category) => category.id === object.categoryId);
    const items = (byObject.get(object.id) ?? []).sort((a, b) => a.position - b.position);
    return { id: object.id, title: object.title, category: category?.name ?? "", category_color: category?.color ?? "", status: object.status, position: object.position, archived: !!object.archivedAt, archived_at: object.archivedAt ?? "", cancelled: !!object.cancelledAt, cancelled_at: object.cancelledAt ?? "", goal: object.goal, current_state: object.currentState, next_action: object.nextAction, checklist_completed: items.filter((item) => item.completed).length, checklist_total: items.length, checklist_text: items.map((item) => `${item.completed ? "[x]" : "[ ]"} ${item.title}`).join("\n"), created_at: object.createdAt, updated_at: object.updatedAt };
  });
  return stringify(records, { header: true, bom: true, escape_formulas: true, columns: ["id", "title", "category", "category_color", "status", "position", "archived", "archived_at", "cancelled", "cancelled_at", "goal", "current_state", "next_action", "checklist_completed", "checklist_total", "checklist_text", "created_at", "updated_at"] });
}
