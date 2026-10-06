import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, getTableColumns } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./index";
import { categories, checklistItems, objectDependencies, objects, objectUpdates } from "./schema";
import { copyTablesForRecurrence, insertTableStructureInTx } from "./tables";
import { InvalidCategoryError } from "@/lib/categories/suggestion";
import { ReplanValidationError, validateReplanProposal } from "@/lib/ai/replan-validation";
import type {
  ChecklistItem,
  ManagedObject,
  ObjectStatus,
  RecurrenceBasis,
  RecurrenceFrequency,
} from "@/lib/types/object";

type ObjectRow = typeof objects.$inferSelect;
type ChecklistRow = typeof checklistItems.$inferSelect;
import { deriveNextAction, sortChecklist, withDerivedCompletion } from "@/lib/objects/next-action";
import { addInterval, today } from "@/lib/recurrence/calc";
export { deriveNextAction, COMPLETION_NEXT_ACTION } from "@/lib/objects/next-action";

function toChecklistItem(row: ChecklistRow): ChecklistItem {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed,
    estimatedMinutes: row.estimatedMinutes ?? null,
    parentId: row.parentId ?? null,
    position: row.position,
  };
}

function prepareChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return sortChecklist(withDerivedCompletion(items));
}

function resolveRecurrenceDisplayRow(row: ObjectRow, rowsById: Map<string, ObjectRow>): ObjectRow {
  if (row.recurrenceNextDate || !row.nextOccurrenceId) return row;
  const next = rowsById.get(row.nextOccurrenceId);
  return next?.recurrenceNextDate
    ? { ...row, recurrenceNextDate: next.recurrenceNextDate }
    : row;
}

/** Future recurring occurrences stay out of the active Board until their date. */
function boardOccurrenceFilter(todayDate: string) {
  return or(
    isNull(objects.previousOccurrenceId),
    ne(objects.status, "idea"),
    isNull(objects.recurrenceNextDate),
    lte(objects.recurrenceNextDate, todayDate),
  );
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
    recurrence: row.recurrenceFrequency
      ? {
          seriesId: row.recurrenceSeriesId ?? row.id,
          frequency: row.recurrenceFrequency,
          interval: row.recurrenceInterval,
          basis: row.recurrenceBasis ?? "scheduled_date",
          nextDate: row.recurrenceNextDate,
          previousOccurrenceId: row.previousOccurrenceId,
          nextOccurrenceId: row.nextOccurrenceId,
        }
      : null,
    occurrenceNote: row.occurrenceNote ?? null,
  };
}

export async function getObjects(): Promise<ManagedObject[]> {
  return loadObjects();
}

/** Board payload: future generated occurrences are kept in storage but wait until due. */
export async function getBoardObjects(): Promise<ManagedObject[]> {
  const db = getDb();
  const boardDate = today();
  await db.transaction(async (tx) => {
    const dueOccurrences = await tx.select({ id: objects.id, previousOccurrenceId: objects.previousOccurrenceId, title: objects.title })
      .from(objects)
      .where(and(
        isNull(objects.archivedAt),
        eq(objects.status, "idea"),
        isNotNull(objects.previousOccurrenceId),
        lte(objects.recurrenceNextDate, boardDate),
      ))
      .for("update");
    const predecessorIds = [...new Set(dueOccurrences.flatMap((occurrence) => occurrence.previousOccurrenceId ? [occurrence.previousOccurrenceId] : []))];
    if (!predecessorIds.length) return;

    const completedPredecessors = await tx.select({ id: objects.id, title: objects.title })
      .from(objects)
      .where(and(inArray(objects.id, predecessorIds), eq(objects.status, "done"), isNull(objects.archivedAt)))
      .for("update");
    if (!completedPredecessors.length) return;

    const archivedAt = new Date();
    await tx.update(objects).set({ archivedAt, updatedAt: archivedAt })
      .where(inArray(objects.id, completedPredecessors.map((object) => object.id)));
    await tx.insert(objectUpdates).values(completedPredecessors.map((object) => ({
      id: randomUUID(),
      objectId: object.id,
      type: "object_archived",
      content: `Archived completed occurrence when its next occurrence became due: ${object.title}.`,
    })));
  });
  return loadObjects(boardDate);
}

export interface UpcomingOccurrenceSummary {
  id: string;
  title: string;
  category: string | null;
  categoryId: string | null;
  nextDate: string;
}

export async function getUpcomingOccurrences(): Promise<UpcomingOccurrenceSummary[]> {
  const rows = await getDb().select({
    id: objects.id,
    title: objects.title,
    category: objects.category,
    categoryId: objects.categoryId,
    nextDate: objects.recurrenceNextDate,
  }).from(objects).where(and(
    isNull(objects.archivedAt),
    eq(objects.status, "idea"),
    isNotNull(objects.previousOccurrenceId),
    gt(objects.recurrenceNextDate, today()),
  )).orderBy(asc(objects.recurrenceNextDate), asc(objects.position), asc(objects.createdAt));
  return rows.filter((row): row is typeof row & { nextDate: string } => row.nextDate !== null);
}

async function loadObjects(boardDate?: string): Promise<ManagedObject[]> {
  const db = getDb();
  const activeFilter = boardDate
    ? and(isNull(objects.archivedAt), boardOccurrenceFilter(boardDate))
    : isNull(objects.archivedAt);
  const [objectRows, itemRows, dependencyRows] = await Promise.all([
    db.select().from(objects).where(activeFilter).orderBy(asc(objects.status), asc(objects.position), asc(objects.createdAt), asc(objects.id)),
    db
      .select(getTableColumns(checklistItems))
      .from(checklistItems)
      .innerJoin(objects, eq(checklistItems.objectId, objects.id))
      .where(activeFilter)
      .orderBy(asc(checklistItems.position)),
    db
      .select({ objectId: objectDependencies.objectId, unresolved: count() })
      .from(objectDependencies)
      .innerJoin(objects, eq(objectDependencies.dependsOnObjectId, objects.id))
      .where(and(ne(objects.status, "done"), activeFilter))
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
  const rowsById = new Map(objectRows.map((row) => [row.id, row]));

  return objectRows.map((row) =>
    toManagedObject(resolveRecurrenceDisplayRow(row, rowsById), prepareChecklist(itemsByObject.get(row.id) ?? []), unresolvedByObject.get(row.id) ?? 0),
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

  let displayRow = objectRow;
  if (!displayRow.recurrenceNextDate && displayRow.nextOccurrenceId) {
    const [next] = await db
      .select({ recurrenceNextDate: objects.recurrenceNextDate })
      .from(objects)
      .where(eq(objects.id, displayRow.nextOccurrenceId))
      .limit(1);
    if (next?.recurrenceNextDate) displayRow = { ...displayRow, recurrenceNextDate: next.recurrenceNextDate };
  }

  const itemRows = await db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.objectId, id))
    .orderBy(asc(checklistItems.position));

  return toManagedObject(displayRow, prepareChecklist(itemRows.map(toChecklistItem)));
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

/**
 * Insert an Object, its checklist and the object_created activity inside an
 * existing transaction. Shared by `createObject` and the AI structured-create
 * path so the complete creation stays atomic. Returns the new Object id.
 */
export async function insertObjectWithChecklist(
  tx: Tx,
  input: CreateObjectInput,
): Promise<string> {
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

  return id;
}

export async function createObject(
  input: CreateObjectInput,
): Promise<ManagedObject> {
  const db = getDb();
  let id = "";
  await db.transaction(async (tx) => {
    id = await insertObjectWithChecklist(tx, input);
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

/**
 * Generate the next occurrence of a recurring Object, inside an existing
 * transaction. Returns the new Object id, or null when the Object is not
 * recurring or has already generated its next occurrence (idempotent).
 *
 * The current Object stays Done and is never reset. The new occurrence copies
 * reusable template fields, clones checklist structure with completion reset,
 * derives Next Action, and links lineage. Occurrence Note, Current State,
 * archive/cancel state and dependencies are intentionally NOT copied.
 */
export async function generateNextOccurrence(tx: Tx, objectId: string): Promise<string | null> {
  const [current] = await tx.select().from(objects).where(eq(objects.id, objectId)).for("update");
  if (!current || !current.recurrenceFrequency || current.nextOccurrenceId) return null;

  const items = await tx
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.objectId, objectId))
    .orderBy(asc(checklistItems.position));

  const baseDate = current.recurrenceBasis === "completion_date" ? today() : (current.recurrenceNextDate ?? today());
  const nextDate = addInterval(baseDate, current.recurrenceFrequency, current.recurrenceInterval);

  const nextId = randomUUID();
  await tx.insert(objects).values({
    id: nextId,
    title: current.title,
    goal: current.goal,
    categoryId: current.categoryId,
    status: "idea",
    recurrenceSeriesId: current.recurrenceSeriesId ?? current.id,
    recurrenceFrequency: current.recurrenceFrequency,
    recurrenceInterval: current.recurrenceInterval,
    recurrenceBasis: current.recurrenceBasis,
    recurrenceNextDate: nextDate,
    previousOccurrenceId: current.id,
    occurrenceNote: null,
  });

  const idMap = new Map<string, string>();
  for (const item of items) idMap.set(item.id, randomUUID());
  const insertRows = items.map((item) => ({
    id: idMap.get(item.id)!,
    objectId: nextId,
    parentId: item.parentId ? (idMap.get(item.parentId) ?? null) : null,
    title: item.title,
    completed: false,
    position: item.position,
    estimatedMinutes: item.estimatedMinutes,
  }));
  if (insertRows.length) {
    await tx.insert(checklistItems).values(insertRows);
    const nextActionItems: ChecklistItem[] = insertRows;
    await tx.update(objects).set({ nextAction: deriveNextAction(nextActionItems) }).where(eq(objects.id, nextId));
  }

  // Object Tables are copied with explicit carry-forward semantics: only rows
  // flagged for repeat exist again, and only flagged columns keep their value.
  await copyTablesForRecurrence(tx, current.id, nextId);

  await tx.update(objects).set({ nextOccurrenceId: nextId, recurrenceNextDate: nextDate }).where(eq(objects.id, current.id));

  await tx.insert(objectUpdates).values({ id: randomUUID(), objectId: current.id, type: "recurrence_generated", content: `Generated next occurrence for ${nextDate}` });
  await tx.insert(objectUpdates).values({ id: randomUUID(), objectId: nextId, type: "object_created", content: `Created from recurring Object: ${current.title}` });

  return nextId;
}

/**
 * Reopen a completed recurring occurrence without deleting its history.
 * Completion-date recurrence cancels the generated next occurrence because
 * the next date was derived from a completion that is now being undone.
 * Scheduled-date recurrence keeps its already scheduled next occurrence.
 */
async function reopenRecurringOccurrence(tx: Tx, current: ObjectRow, targetStatus: ObjectStatus): Promise<void> {
  if (current.status !== "done" || targetStatus === "done" || !current.recurrenceFrequency) return;

  const now = new Date();
  if (current.recurrenceBasis === "completion_date") {
    if (current.nextOccurrenceId) {
      await tx
        .update(objects)
        .set({ archivedAt: now, cancelledAt: now, updatedAt: now })
        .where(eq(objects.id, current.nextOccurrenceId));
      await tx.insert(objectUpdates).values({
        id: randomUUID(),
        objectId: current.nextOccurrenceId,
        type: "recurrence_next_cancelled",
        content: `Cancelled next occurrence because ${current.title} was reopened.`,
      });
    }
    await tx
      .update(objects)
      .set({ nextOccurrenceId: null, recurrenceNextDate: null, updatedAt: now })
      .where(eq(objects.id, current.id));
    await tx.insert(objectUpdates).values({
      id: randomUUID(),
      objectId: current.id,
      type: "recurrence_reopened",
      content: "Reopened recurring Object; cancelled the next completion-based occurrence.",
    });
    return;
  }

  await tx.insert(objectUpdates).values({
    id: randomUUID(),
    objectId: current.id,
    type: "recurrence_reopened",
    content: "Reopened recurring Object; preserved the scheduled next occurrence.",
  });
}

export interface RecurrenceInput {
  frequency: RecurrenceFrequency;
  interval: number;
  basis: RecurrenceBasis;
  nextDate: string | null;
}

/**
 * Enable, update, or disable recurrence on an Object. Passing `null` disables
 * recurrence (the Object stops generating future occurrences but keeps its
 * lineage history). Enabling a previously non-recurring Object seeds its
 * series identity with its own id.
 */
export async function updateObjectRecurrence(objectId: string, input: RecurrenceInput | null): Promise<ManagedObject> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(objects).where(eq(objects.id, objectId)).for("update");
    if (!current) throw new Error("Object not found.");

    if (!input) {
      await tx
        .update(objects)
        .set({ recurrenceFrequency: null, recurrenceBasis: null, recurrenceNextDate: null, updatedAt: new Date() })
        .where(eq(objects.id, objectId));
      await tx.insert(objectUpdates).values({ id: randomUUID(), objectId, type: "recurrence_disabled", content: "Stopped recurrence." });
      return;
    }

    const wasRecurring = !!current.recurrenceFrequency;
    const [existingNextOccurrence] = current.nextOccurrenceId
      ? await tx
        .select({ recurrenceNextDate: objects.recurrenceNextDate })
        .from(objects)
        .where(eq(objects.id, current.nextOccurrenceId))
        .limit(1)
      : [];
    const nextDate = input.nextDate ?? existingNextOccurrence?.recurrenceNextDate ?? null;
    await tx
      .update(objects)
      .set({
        recurrenceSeriesId: current.recurrenceSeriesId ?? objectId,
        recurrenceFrequency: input.frequency,
        recurrenceInterval: input.interval,
        recurrenceBasis: input.basis,
        recurrenceNextDate: nextDate,
        updatedAt: new Date(),
      })
      .where(eq(objects.id, objectId));
    await tx.insert(objectUpdates).values({
      id: randomUUID(),
      objectId,
      type: wasRecurring ? "recurrence_updated" : "recurrence_enabled",
      content: wasRecurring ? "Updated recurrence." : `Enabled recurrence: every ${input.interval} ${input.frequency}.`,
    });
  });
  const updated = await getObject(objectId);
  if (!updated) throw new Error("Object not found.");
  return updated;
}

/** Update the free-form occurrence note (not copied to the next occurrence). */
export async function updateOccurrenceNote(objectId: string, note: string): Promise<ManagedObject> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [current] = await tx.select({ id: objects.id }).from(objects).where(eq(objects.id, objectId)).for("update");
    if (!current) throw new Error("Object not found.");
    await tx.update(objects).set({ occurrenceNote: note, updatedAt: new Date() }).where(eq(objects.id, objectId));
    await tx.insert(objectUpdates).values({ id: randomUUID(), objectId, type: "occurrence_note_updated", content: "Updated occurrence note." });
  });
  const updated = await getObject(objectId);
  if (!updated) throw new Error("Object not found.");
  return updated;
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

    if (status === "done") await generateNextOccurrence(tx, id);
    else if (current.status === "done") await reopenRecurringOccurrence(tx, current, status);

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
): Promise<ManagedObject[]> {
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
    const boardDate = today();
    const visibleTargetIds = new Set(targetRows
      .filter((row) => row.id !== objectId && (!row.previousOccurrenceId || !row.recurrenceNextDate || row.recurrenceNextDate <= boardDate))
      .map((row) => row.id));
    if (
      requested.size !== orderedObjectIds.length ||
      orderedObjectIds.some((id) => !expectedIds.includes(id)) ||
      !requested.has(objectId) ||
      [...visibleTargetIds].some((id) => !requested.has(id))
    ) {
      throw new Error("Invalid Object ordering.");
    }

    const targetRowsWithoutMoving = targetRows.filter((row) => row.id !== objectId);
    const desiredExistingVisible = orderedObjectIds.filter((id) => id !== objectId);
    const mergedTarget: string[] = [];
    let visibleIndex = 0;
    for (const row of targetRowsWithoutMoving) {
      mergedTarget.push(visibleTargetIds.has(row.id) ? desiredExistingVisible[visibleIndex++] : row.id);
    }
    const movingIndex = orderedObjectIds.indexOf(objectId);
    const movingVisibleIndex = orderedObjectIds
      .slice(0, movingIndex)
      .filter((id) => visibleTargetIds.has(id)).length;
    let visibleSeen = 0;
    let inserted = false;
    const persistedTargetOrder: string[] = [];
    for (const id of mergedTarget) {
      if (!inserted && visibleSeen === movingVisibleIndex) {
        persistedTargetOrder.push(objectId);
        inserted = true;
      }
      persistedTargetOrder.push(id);
      if (visibleTargetIds.has(id)) visibleSeen += 1;
    }
    if (!inserted) persistedTargetOrder.push(objectId);

    const now = new Date();
    for (const [position, id] of persistedTargetOrder.entries()) {
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
      if (targetStatus === "done") await generateNextOccurrence(tx, objectId);
      else if (moving.status === "done") await reopenRecurringOccurrence(tx, moving, targetStatus);
      await tx.insert(objectUpdates).values({
        id: randomUUID(), objectId, type: "status_changed", content: targetStatus,
      });
    }
  });
  return getBoardObjects();
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

type ReplanChecklistChild = { sourceItemId: string | null; title: string; completed: boolean; changeType: "keep" | "modify" | "add" };
type ReplanChecklistItem = ReplanChecklistChild & { children: ReplanChecklistChild[] };
type ReplanTable = { title: string; columns: { name: string; type: "text" | "number" | "date" | "currency" | "checkbox"; currency: string | null; carryForward: boolean }[]; rows: { carryForward: boolean; cells: string[] }[] };
type ReplanProposal = { proposalId?: string; title: string | null; goal: string | null; currentState: string; checklistMode?: "preserve" | "replan"; checklist: ReplanChecklistItem[]; removedItemIds: string[]; tablesToAdd?: ReplanTable[]; summary: string };

export async function applyAIReplan(objectId: string, proposal: ReplanProposal) {
  if (proposal.checklistMode === "preserve" && !proposal.tablesToAdd?.length) {
    throw new ReplanValidationError("MISSING_REQUESTED_TABLE", "The table-only proposal contains no tables. Generate a new proposal. No changes were saved.");
  }
  const db = getDb();
  await db.transaction(async (tx) => {
    const [object] = await tx.select({ id: objects.id }).from(objects).where(eq(objects.id, objectId)).for("update");
    if (!object) throw new Error("Object not found.");
    // The locked Object serializes retries. Reuse the actual Activity record as
    // the confirmation marker so a network retry cannot add the same tables twice.
    if (proposal.proposalId) {
      const [applied] = await tx.select().from(objectUpdates).where(eq(objectUpdates.id, proposal.proposalId));
      if (applied) {
        if (applied.objectId !== objectId || applied.type !== "ai_replan") throw new Error("UPDATE_CONFLICT");
        return;
      }
    }
    const existing = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId));
    if (proposal.checklistMode !== "preserve") validateReplanProposal(proposal, existing.map(toChecklistItem));

    const applyItem = async (item: { sourceItemId: string | null; title: string; completed: boolean }, parentId: string | null, position: number): Promise<string> => {
      if (item.sourceItemId) {
        await tx.update(checklistItems).set({ title: item.title, completed: item.completed, position, parentId, updatedAt: new Date() }).where(eq(checklistItems.id, item.sourceItemId));
        return item.sourceItemId;
      }
      const newId = randomUUID();
      await tx.insert(checklistItems).values({ id: newId, objectId, parentId, title: item.title, completed: item.completed, position });
      return newId;
    };

    if (proposal.checklistMode !== "preserve") {
      for (const [ti, item] of proposal.checklist.entries()) {
        const parentId = await applyItem(item, null, ti);
        for (const [ci, child] of item.children.entries()) {
          await applyItem(child, parentId, ci);
        }
      }

      if (proposal.removedItemIds.length) {
        for (const id of proposal.removedItemIds) await tx.delete(checklistItems).where(eq(checklistItems.id, id));
      }
    }

    if (proposal.checklistMode !== "preserve") await syncParentCompletion(tx, objectId);
    const finalItems = await tx.select().from(checklistItems).where(eq(checklistItems.objectId, objectId));
    for (const table of proposal.tablesToAdd ?? []) await insertTableStructureInTx(tx, objectId, table);
    await tx.update(objects).set({ ...(proposal.checklistMode === "preserve" ? {} : { ...(proposal.title ? { title: proposal.title } : {}), ...(proposal.goal ? { goal: proposal.goal } : {}), currentState: proposal.currentState, nextAction: deriveNextAction(finalItems) }), updatedAt: new Date() }).where(eq(objects.id, objectId));
    await tx.insert(objectUpdates).values({ id: proposal.proposalId ?? randomUUID(), objectId, type: "ai_replan", content: proposal.summary });
  });
  const result = await getObject(objectId);
  if (!result) throw new Error("Object not found.");
  return result;
}
