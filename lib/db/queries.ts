import { and, asc, count, desc, eq, isNull, ne, getTableColumns } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./index";
import { categories, checklistItems, objectDependencies, objects, objectUpdates } from "./schema";
import { InvalidCategoryError } from "@/lib/categories/suggestion";
import type {
  ChecklistItem,
  ManagedObject,
  ObjectStatus,
} from "@/lib/types/object";

type ObjectRow = typeof objects.$inferSelect;
type ChecklistRow = typeof checklistItems.$inferSelect;
import { deriveNextAction, sortChecklist, withDerivedCompletion } from "@/lib/objects/next-action";
export { deriveNextAction, COMPLETION_NEXT_ACTION } from "@/lib/objects/next-action";

function toChecklistItem(row: ChecklistRow): ChecklistItem {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed,
    parentId: row.parentId ?? null,
    position: row.position,
  };
}

function prepareChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return sortChecklist(withDerivedCompletion(items));
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function syncParentCompletion(tx: Tx, objectId: string): Promise<void> {
  const items = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId));
  const agg = new Map<string, { total: number; done: number }>();
  for (const item of items) {
    if (item.parentId) {
      const entry = agg.get(item.parentId) ?? { total: 0, done: 0 };
      entry.total += 1;
      if (item.completed) entry.done += 1;
      agg.set(item.parentId, entry);
    }
  }
  for (const [parentId, entry] of agg) {
    await tx.update(checklistItems).set({ completed: entry.done === entry.total, updatedAt: new Date() }).where(eq(checklistItems.id, parentId));
  }
}

export function toManagedObject(row: ObjectRow, items: ChecklistItem[], unresolvedDependencies = 0): ManagedObject {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    position: row.position,
    category: row.category ?? null,
    categoryId: row.categoryId ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    goal: row.goal,
    currentState: row.currentState,
    nextAction: row.nextAction,
    checklist: items,
    unresolvedDependencies,
  };
}

export async function getObjects(): Promise<ManagedObject[]> {
  const db = getDb();
  const [objectRows, itemRows, dependencyRows] = await Promise.all([
    db.select().from(objects).where(isNull(objects.archivedAt)).orderBy(asc(objects.status), asc(objects.position), asc(objects.createdAt), asc(objects.id)),
    db
      .select(getTableColumns(checklistItems))
      .from(checklistItems)
      .innerJoin(objects, eq(checklistItems.objectId, objects.id))
      .where(isNull(objects.archivedAt))
      .orderBy(asc(checklistItems.position)),
    db
      .select({ objectId: objectDependencies.objectId, unresolved: count() })
      .from(objectDependencies)
      .innerJoin(objects, eq(objectDependencies.dependsOnObjectId, objects.id))
      .where(ne(objects.status, "done"))
      .groupBy(objectDependencies.objectId),
  ]);

  const itemsByObject = new Map<string, ChecklistItem[]>();
  for (const row of itemRows) {
    const list = itemsByObject.get(row.objectId) ?? [];
    list.push(toChecklistItem(row));
    itemsByObject.set(row.objectId, list);
  }

  const unresolvedByObject = new Map<string, number>();
  for (const row of dependencyRows) unresolvedByObject.set(row.objectId, row.unresolved);

  return objectRows.map((row) =>
    toManagedObject(row, prepareChecklist(itemsByObject.get(row.id) ?? []), unresolvedByObject.get(row.id) ?? 0),
  );
}

export async function getObject(id: string): Promise<ManagedObject | null> {
  const db = getDb();
  const [objectRow] = await db
    .select()
    .from(objects)
    .where(eq(objects.id, id))
    .limit(1);

  if (!objectRow) return null;

  const itemRows = await db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.objectId, id))
    .orderBy(asc(checklistItems.position));

  return toManagedObject(objectRow, prepareChecklist(itemRows.map(toChecklistItem)));
}

export interface CreateObjectChecklistInput {
  title: string;
  completed: boolean;
  children?: { title: string; completed: boolean }[];
}

export interface CreateObjectInput {
  categoryId?: string | null;
  title: string;
  goal?: string;
  currentState?: string;
  nextAction?: string;
  status?: ObjectStatus;
  checklist?: CreateObjectChecklistInput[];
  activityContent?: string;
}

export async function createObject(
  input: CreateObjectInput,
): Promise<ManagedObject> {
  const db = getDb();
  const id = randomUUID();
  const {
    categoryId = null,
    title,
    goal = "",
    currentState = "",
    nextAction = "",
    status = "idea",
    checklist = [],
    activityContent = "Object created.",
  } = input;

  await db.transaction(async (tx) => {
    if (categoryId !== null) {
      const [category] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).for("share");
      if (!category) throw new InvalidCategoryError();
    }
    const last = await tx
      .select({ position: objects.position })
      .from(objects)
      .where(and(eq(objects.status, status), isNull(objects.archivedAt)))
      .orderBy(desc(objects.position))
      .limit(1);
    await tx
      .insert(objects)
      .values({ id, title, goal, currentState, nextAction, status, categoryId, position: (last[0]?.position ?? -1) + 1 });

    if (checklist.length > 0) {
      const rows: { id: string; objectId: string; parentId: string | null; title: string; completed: boolean; position: number }[] = [];
      for (const [ti, item] of checklist.entries()) {
        const parentId = randomUUID();
        rows.push({ id: parentId, objectId: id, parentId: null, title: item.title, completed: item.completed, position: ti });
        for (const [ci, child] of (item.children ?? []).entries()) {
          rows.push({ id: randomUUID(), objectId: id, parentId, title: child.title, completed: child.completed, position: ci });
        }
      }
      await tx.insert(checklistItems).values(rows);
      await syncParentCompletion(tx, id);
      const all = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, id));
      await tx.update(objects).set({ nextAction: deriveNextAction(all), updatedAt: new Date() }).where(eq(objects.id, id));
    }

    await tx.insert(objectUpdates).values({
      id: randomUUID(),
      objectId: id,
      type: "object_created",
      content: activityContent,
    });
  });

  const created = await getObject(id);
  if (!created) throw new Error("Failed to load the created object.");
  return created;
}

export interface UpdateObjectInput {
  title?: string;
  goal?: string;
  currentState?: string;
  nextAction?: string;
  status?: ObjectStatus;
}

export async function updateObject(
  id: string,
  input: UpdateObjectInput,
): Promise<ManagedObject> {
  const db = getDb();
  await db
    .update(objects)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(objects.id, id));

  const updated = await getObject(id);
  if (!updated) throw new Error("Object not found.");
  return updated;
}

export async function deleteObject(id: string): Promise<void> {
  const db = getDb();
  await db.delete(objects).where(eq(objects.id, id));
}

export async function updateObjectStatus(
  id: string,
  status: ObjectStatus,
): Promise<ManagedObject> {
  const db = getDb();

  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(objects).where(eq(objects.id, id)).for("update");
    if (!current) throw new Error("Object not found.");
    if (current.status === status) return;

    await tx
      .update(objects)
      .set({ status, updatedAt: new Date() })
      .where(eq(objects.id, id));

    await tx.insert(objectUpdates).values({
      id: randomUUID(),
      objectId: id,
      type: "status_changed",
      content: status,
    });
  });

  const updated = await getObject(id);
  if (!updated) throw new Error("Object not found.");
  return updated;
}

export async function reorderObjects(
  objectId: string,
  targetStatus: ObjectStatus,
  orderedObjectIds: string[],
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(objects).where(eq(objects.id, objectId)).for("update");
    if (!current) throw new Error("Object not found.");
    const [moving] = await tx
      .select()
      .from(objects)
      .where(and(eq(objects.id, objectId), isNull(objects.archivedAt)))
      .limit(1);
    if (!moving) throw new Error("Object not found.");

    const targetRows = await tx
      .select()
      .from(objects)
      .where(and(eq(objects.status, targetStatus), isNull(objects.archivedAt)))
      .orderBy(asc(objects.position), asc(objects.createdAt), asc(objects.id));
    const expectedIds = targetRows
      .filter((row) => row.id !== objectId)
      .map((row) => row.id)
      .concat(objectId);
    const requested = new Set(orderedObjectIds);
    if (
      requested.size !== orderedObjectIds.length ||
      requested.size !== expectedIds.length ||
      expectedIds.some((id) => !requested.has(id))
    ) {
      throw new Error("Invalid Object ordering.");
    }

    const now = new Date();
    for (const [position, id] of orderedObjectIds.entries()) {
      await tx
        .update(objects)
        .set({ position, ...(id === objectId ? { status: targetStatus, updatedAt: now } : {}) })
        .where(eq(objects.id, id));
    }

    if (moving.status !== targetStatus) {
      const sourceRows = await tx
        .select({ id: objects.id })
        .from(objects)
        .where(and(eq(objects.status, moving.status), isNull(objects.archivedAt)))
        .orderBy(asc(objects.position), asc(objects.createdAt), asc(objects.id));
      for (const [position, row] of sourceRows.entries()) {
        await tx.update(objects).set({ position }).where(eq(objects.id, row.id));
      }
      await tx.insert(objectUpdates).values({
        id: randomUUID(), objectId, type: "status_changed", content: targetStatus,
      });
    }
  });
}

export async function updateChecklistItem(
  itemId: string,
  completed: boolean,
): Promise<ChecklistItem> {
  const db = getDb();

  const updated = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(checklistItems).where(eq(checklistItems.id, itemId)).for("update");
    if (!current) throw new Error("Checklist item not found.");
    const children = await tx.select().from(checklistItems).where(eq(checklistItems.parentId, itemId));
    if (children.length > 0) throw new Error("Parent completion is derived from its children.");
    if (current.completed === completed) return current;
    const rows = await tx
      .update(checklistItems)
      .set({ completed, updatedAt: new Date() })
      .where(eq(checklistItems.id, itemId))
      .returning();

    const row = rows[0];
    if (!row) throw new Error("Checklist item not found.");

    if (row.parentId) {
      const siblingRows = await tx.select().from(checklistItems).where(eq(checklistItems.parentId, row.parentId));
      const allDone = siblingRows.every((sibling) => sibling.completed);
      await tx.update(checklistItems).set({ completed: allDone, updatedAt: new Date() }).where(eq(checklistItems.id, row.parentId));
    }

    const siblings = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, row.objectId));
    await tx.update(objects).set({ currentState: `${completed ? "已完成" : "已重新打开"}：${row.title}`, nextAction: deriveNextAction(siblings), updatedAt: new Date() }).where(eq(objects.id, row.objectId));
    await tx.insert(objectUpdates).values({
      id: randomUUID(),
      objectId: row.objectId,
      type: "checklist_changed",
      content: `${completed ? "Checked" : "Unchecked"}: ${row.title}`,
    });

    return row;
  });

  return toChecklistItem(updated);
}

export type EditableObjectField = "title" | "goal" | "currentState" | "nextAction";

export async function updateObjectField(
  id: string,
  field: EditableObjectField,
  value: string,
): Promise<ManagedObject> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(objects).where(eq(objects.id, id)).for("update");
    if (!current) throw new Error("Object not found.");
    if (current[field] === value) return;
    const rows = await tx.update(objects).set({ [field]: value, updatedAt: new Date() }).where(eq(objects.id, id)).returning();
    if (!rows[0]) throw new Error("Object not found.");
    // Activity records actual progress, not each edit to the plan/presentation.
    if (field === "currentState") {
      await tx.insert(objectUpdates).values({ id: randomUUID(), objectId: id, type: "object_edited", content: `Current State: ${value}` });
    }
  });
  const updated = await getObject(id);
  if (!updated) throw new Error("Object not found.");
  return updated;
}

export async function createChecklistItem(objectId: string, title: string, parentId: string | null = null): Promise<ChecklistItem> {
  const db = getDb();
  const item = await db.transaction(async (tx) => {
    if (parentId) {
      const [parent] = await tx.select().from(checklistItems).where(eq(checklistItems.id, parentId));
      if (!parent || parent.objectId !== objectId) throw new Error("Parent checklist item not found.");
      if (parent.parentId) throw new Error("Only one level of nesting is allowed.");
    }
    const siblings = await tx
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.objectId, objectId), parentId ? eq(checklistItems.parentId, parentId) : isNull(checklistItems.parentId)))
      .orderBy(asc(checklistItems.position));
    const position = siblings.length;
    const rows = await tx.insert(checklistItems).values({ id: randomUUID(), objectId, parentId, title, completed: false, position }).returning();
    if (!rows[0]) throw new Error("Could not create checklist item.");
    if (parentId) {
      const parentChildren = await tx.select().from(checklistItems).where(eq(checklistItems.parentId, parentId));
      const allDone = parentChildren.every((c) => c.completed);
      await tx.update(checklistItems).set({ completed: allDone, updatedAt: new Date() }).where(eq(checklistItems.id, parentId));
    }
    const all = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId));
    await tx.update(objects).set({ nextAction: deriveNextAction(all), updatedAt: new Date() }).where(eq(objects.id, objectId));
    return rows[0];
  });
  return toChecklistItem(item);
}

export async function renameChecklistItem(itemId: string, objectId: string, title: string): Promise<ChecklistItem> {
  const db = getDb();
  const item = await db.transaction(async (tx) => {
    const existing = await tx.select().from(checklistItems).where(eq(checklistItems.id, itemId));
    const row = existing[0];
    if (!row || row.objectId !== objectId) throw new Error("Checklist item not found.");
    await tx.update(checklistItems).set({ title, updatedAt: new Date() }).where(eq(checklistItems.id, itemId));
    const siblings = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId));
    await tx.update(objects).set({ nextAction: deriveNextAction(siblings), updatedAt: new Date() }).where(eq(objects.id, objectId));
    return { ...row, title };
  });
  return toChecklistItem(item);
}

export async function deleteChecklistItem(itemId: string, objectId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(checklistItems).where(eq(checklistItems.id, itemId));
    const row = existing[0];
    if (!row || row.objectId !== objectId) throw new Error("Checklist item not found.");
    const parentId = row.parentId;
    await tx.delete(checklistItems).where(eq(checklistItems.parentId, itemId));
    await tx.delete(checklistItems).where(eq(checklistItems.id, itemId));
    const siblings = await tx
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.objectId, objectId), parentId ? eq(checklistItems.parentId, parentId) : isNull(checklistItems.parentId)))
      .orderBy(asc(checklistItems.position));
    for (const [position, sibling] of siblings.entries()) {
      await tx.update(checklistItems).set({ position, updatedAt: new Date() }).where(eq(checklistItems.id, sibling.id));
    }
    const all = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId));
    await tx.update(objects).set({ nextAction: deriveNextAction(all), updatedAt: new Date() }).where(eq(objects.id, objectId));
  });
}

export async function reorderChecklistItems(objectId: string, parentId: string | null, orderedItemIds: string[]): Promise<ChecklistItem[]> {
  const db = getDb();
  const items = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.objectId, objectId), parentId ? eq(checklistItems.parentId, parentId) : isNull(checklistItems.parentId)));
    const [objectRow] = await tx.select().from(objects).where(eq(objects.id, objectId)).limit(1);
    if (!objectRow || new Set(orderedItemIds).size !== orderedItemIds.length || rows.length !== orderedItemIds.length || rows.some((row) => !orderedItemIds.includes(row.id))) {
      throw new Error("Invalid checklist ordering.");
    }
    for (const [position, id] of orderedItemIds.entries()) {
      await tx.update(checklistItems).set({ position, updatedAt: new Date() }).where(eq(checklistItems.id, id));
    }
    const all = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId));
    await tx.update(objects).set({ nextAction: deriveNextAction(all), updatedAt: new Date() }).where(eq(objects.id, objectId));
    return orderedItemIds.map((id) => rows.find((row) => row.id === id)!);
  });
  return items.map((item, position) => toChecklistItem({ ...item, position }));
}

export async function createObjectUpdate(
  objectId: string,
  type: string,
  content: string,
): Promise<void> {
  const db = getDb();
  await db
    .insert(objectUpdates)
    .values({ id: randomUUID(), objectId, type, content });
}

export async function getRecentObjectUpdates(objectId: string, limit = 10) {
  const db = getDb();
  return db.select().from(objectUpdates).where(eq(objectUpdates.objectId, objectId)).orderBy(asc(objectUpdates.createdAt)).then((rows) => rows.slice(-limit));
}

export async function applyAIProgressUpdate(objectId: string, update: { currentState: string; nextAction: string; completedItemIds: string[]; reopenedItemIds: string[]; newChecklistItems: { title: string; parentItemId: string | null }[]; summary: string }) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const items = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId));
    const ids = new Set(items.map((item) => item.id));
    const parentIds = new Set(items.filter((item) => items.some((other) => other.parentId === item.id)).map((item) => item.id));
    const completed = update.completedItemIds.filter((id) => !parentIds.has(id));
    const reopened = update.reopenedItemIds.filter((id) => !parentIds.has(id));
    const all = [...completed, ...reopened];
    if (new Set(all).size !== all.length || all.some((id) => !ids.has(id)) || completed.some((id) => reopened.includes(id))) throw new Error("UPDATE_CONFLICT");
    await tx.update(objects).set({ currentState: update.currentState, updatedAt: new Date() }).where(eq(objects.id, objectId));
    for (const id of completed) await tx.update(checklistItems).set({ completed: true, updatedAt: new Date() }).where(eq(checklistItems.id, id));
    for (const id of reopened) await tx.update(checklistItems).set({ completed: false, updatedAt: new Date() }).where(eq(checklistItems.id, id));

    const counters = new Map<string, number>();
    for (const item of update.newChecklistItems) {
      let parentId: string | null = null;
      if (item.parentItemId) {
        const parent = items.find((existing) => existing.id === item.parentItemId);
        if (!parent || parent.parentId !== null) throw new Error("UPDATE_CONFLICT");
        parentId = parent.id;
      }
      const key = parentId ?? "__top__";
      const existingSiblings = items.filter((existing) => (parentId ? existing.parentId === parentId : existing.parentId === null));
      const maxPos = existingSiblings.reduce((m, sibling) => Math.max(m, sibling.position), -1);
      const offset = (counters.get(key) ?? 0) + 1;
      counters.set(key, offset);
      await tx.insert(checklistItems).values({ id: randomUUID(), objectId, parentId, title: item.title, completed: false, position: maxPos + offset });
    }

    await syncParentCompletion(tx, objectId);
    const finalItems = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId));
    await tx.update(objects).set({ nextAction: deriveNextAction(finalItems), updatedAt: new Date() }).where(eq(objects.id, objectId));
    await tx.insert(objectUpdates).values({ id: randomUUID(), objectId, type: "ai_progress_update", content: update.summary });
  });
  const result = await getObject(objectId);
  if (!result) throw new Error("Object not found.");
  return result;
}

export async function applyAIReplan(objectId: string, proposal: { title: string | null; goal: string | null; currentState: string; checklist: { sourceItemId: string | null; title: string; completed: boolean; changeType: "keep" | "modify" | "add"; children: { sourceItemId: string | null; title: string; completed: boolean; changeType: "keep" | "modify" | "add" }[] }[]; removedItemIds: string[]; summary: string }) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId));
    const byId = new Map(existing.map((item) => [item.id, item]));
    const childCount = new Map<string, number>();
    for (const item of existing) if (item.parentId) childCount.set(item.parentId, (childCount.get(item.parentId) ?? 0) + 1);

    const sourceIds: string[] = [];
    const collect = (list: { sourceItemId: string | null; children?: { sourceItemId: string | null }[] }[]) => {
      for (const item of list) {
        if (item.sourceItemId) sourceIds.push(item.sourceItemId);
        if (item.children) collect(item.children);
      }
    };
    collect(proposal.checklist);

    const removedIds = new Set(proposal.removedItemIds);
    for (const item of existing) if (item.parentId && removedIds.has(item.parentId)) removedIds.add(item.id);

    if (
      new Set(sourceIds).size !== sourceIds.length ||
      new Set(proposal.removedItemIds).size !== proposal.removedItemIds.length ||
      sourceIds.some((id) => !byId.has(id)) ||
      proposal.removedItemIds.some((id) => !byId.has(id)) ||
      sourceIds.some((id) => removedIds.has(id))
    ) throw new Error("UPDATE_CONFLICT");

    const keepIds = new Set(sourceIds);
    for (const item of existing) {
      if (!keepIds.has(item.id) && !removedIds.has(item.id)) throw new Error("UPDATE_CONFLICT");
    }

    const applyItem = async (item: { sourceItemId: string | null; title: string; completed: boolean }, parentId: string | null, position: number): Promise<string> => {
      if (item.sourceItemId) {
        if (parentId && (childCount.get(item.sourceItemId) ?? 0) > 0) throw new Error("UPDATE_CONFLICT");
        await tx.update(checklistItems).set({ title: item.title, completed: item.completed, position, parentId, updatedAt: new Date() }).where(eq(checklistItems.id, item.sourceItemId));
        return item.sourceItemId;
      }
      const newId = randomUUID();
      await tx.insert(checklistItems).values({ id: newId, objectId, parentId, title: item.title, completed: item.completed, position });
      return newId;
    };

    for (const [ti, item] of proposal.checklist.entries()) {
      const parentId = await applyItem(item, null, ti);
      for (const [ci, child] of item.children.entries()) {
        await applyItem(child, parentId, ci);
      }
    }

    if (proposal.removedItemIds.length) {
      for (const id of proposal.removedItemIds) await tx.delete(checklistItems).where(eq(checklistItems.id, id));
    }

    await syncParentCompletion(tx, objectId);
    const finalItems = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId));
    await tx.update(objects).set({ ...(proposal.title ? { title: proposal.title } : {}), ...(proposal.goal ? { goal: proposal.goal } : {}), currentState: proposal.currentState, nextAction: deriveNextAction(finalItems), updatedAt: new Date() }).where(eq(objects.id, objectId));
    await tx.insert(objectUpdates).values({ id: randomUUID(), objectId, type: "ai_replan", content: proposal.summary });
  });
  const result = await getObject(objectId);
  if (!result) throw new Error("Object not found.");
  return result;
}
