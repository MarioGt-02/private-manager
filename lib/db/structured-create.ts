import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./index";
import { objects, objectUpdates } from "./schema";
import { getObject, insertObjectWithChecklist } from "./queries";
import { insertTableStructureInTx } from "./tables";
import type { RecurrenceFormInput } from "@/lib/types/object";
import type { ManagedObject } from "@/lib/types/object";
import type { DraftTable } from "@/lib/ai/types";

export interface StructuredCreateInput {
  categoryId: string | null;
  title: string;
  goal: string;
  currentState: string;
  nextAction: string;
  checklist: { title: string; completed: boolean; children: { title: string; completed: boolean }[] }[];
  /** Complete, already-validated recurrence; null for a non-recurring Object. */
  recurrence: RecurrenceFormInput | null;
  /** One validated table or null. V1 allows at most one from the AI. */
  table: DraftTable | null;
  activityContent?: string;
}

/**
 * Create a structured Object (fields + category + checklist + recurrence +
 * one table) in ONE transaction. Reuses the shared object/checklist and table
 * persistence helpers, so a failure anywhere rolls the whole creation back.
 */
export async function createStructuredObject(input: StructuredCreateInput): Promise<ManagedObject> {
  const db = getDb();
  let id = "";
  await db.transaction(async (tx) => {
    id = await insertObjectWithChecklist(tx, {
      categoryId: input.categoryId,
      title: input.title,
      goal: input.goal,
      currentState: input.currentState,
      nextAction: input.nextAction,
      status: "idea",
      checklist: input.checklist,
      activityContent: input.activityContent ?? "Object created with AI assistance.",
    });

    if (input.recurrence) {
      await tx
        .update(objects)
        .set({
          recurrenceSeriesId: id,
          recurrenceFrequency: input.recurrence.frequency,
          recurrenceInterval: input.recurrence.interval,
          recurrenceBasis: input.recurrence.basis,
          recurrenceNextDate: input.recurrence.nextDate,
          updatedAt: new Date(),
        })
        .where(eq(objects.id, id));
      await tx.insert(objectUpdates).values({
        id: randomUUID(),
        objectId: id,
        type: "recurrence_enabled",
        content: `Enabled recurrence: every ${input.recurrence.interval} ${input.recurrence.frequency}.`,
      });
    }

    if (input.table) {
      await insertTableStructureInTx(tx, id, input.table);
    }
  });

  const created = await getObject(id);
  if (!created) throw new Error("Failed to load the created object.");
  return created;
}
