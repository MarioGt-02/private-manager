import type { ChecklistItem, ManagedObject } from "@/lib/types/object";
import type { z } from "zod";
import type { replanProposalSchema } from "./replan";

type Proposal = Pick<z.infer<typeof replanProposalSchema>, "checklist" | "removedItemIds">;
type Item = Proposal["checklist"][number];

/** Table-only proposals cannot rewrite Object facts or substitute a checklist step for a real table. */
export function prepareTableOnlyReplan(proposal: z.infer<typeof replanProposalSchema>, object: ManagedObject) {
  if (proposal.tablesToAdd.length === 0) {
    throw new ReplanValidationError("MISSING_REQUESTED_TABLE", "AI did not generate the requested table. No changes were saved. Try generating the proposal again.");
  }
  const keep = (item: ChecklistItem) => ({ sourceItemId: item.id, title: item.title, completed: item.completed, changeType: "keep" as const });
  const summary = `Propose adding: ${proposal.tablesToAdd.map((table) => table.title).join(", ")}. The Object fields, checklist and Next Action remain unchanged. Tables will be saved only after confirmation.`;
  return {
    ...proposal,
    title: null,
    goal: null,
    currentState: object.currentState,
    checklistMode: "preserve" as const,
    checklist: object.checklist.filter((item) => item.parentId === null).sort((a, b) => a.position - b.position).map((item) => ({
      ...keep(item),
      children: object.checklist.filter((child) => child.parentId === item.id).sort((a, b) => a.position - b.position).map(keep),
    })),
    removedItemIds: [],
    reasonSummary: summary,
    summary,
  };
}

/** Repair only an unambiguous title-to-ID mismatch from the model. */
export function repairReplanSourceIds<T extends Proposal>(proposal: T, existing: ChecklistItem[]): T {
  const byTitle = new Map<string, ChecklistItem[]>();
  for (const item of existing) byTitle.set(item.title, [...(byTitle.get(item.title) ?? []), item]);
  const used = new Set<string>();
  const repairSourceId = (item: { sourceItemId: string | null; title: string }) => {
    let sourceItemId = item.sourceItemId;
    if (sourceItemId && !existing.some((current) => current.id === sourceItemId)) {
      const matches = byTitle.get(item.title) ?? [];
      if (matches.length === 1 && !used.has(matches[0].id)) sourceItemId = matches[0].id;
    }
    if (sourceItemId) used.add(sourceItemId);
    return sourceItemId;
  };
  const repair = (item: Item): Item => {
    const sourceItemId = repairSourceId(item);
    return { ...item, sourceItemId, children: item.children.map((child) => ({ ...child, sourceItemId: repairSourceId(child) })) };
  };
  return { ...proposal, checklist: proposal.checklist.map(repair) };
}

export class ReplanValidationError extends Error {
  constructor(public readonly reason: string, message: string) {
    super(message);
    this.name = "ReplanValidationError";
  }
}

function references(proposal: Proposal, existing: ChecklistItem[]) {
  const ids = new Set(existing.map((item) => item.id));
  const sourceIds = proposal.checklist.flatMap((item) => [item.sourceItemId, ...item.children.map((child) => child.sourceItemId)])
    .filter((id): id is string => id !== null);
  const removed = new Set(proposal.removedItemIds);
  if (new Set(sourceIds).size !== sourceIds.length || removed.size !== proposal.removedItemIds.length) {
    throw new ReplanValidationError("DUPLICATE_IDS", "The replan proposal references a checklist item more than once. Generate a new proposal.");
  }
  if ([...sourceIds, ...removed].some((id) => !ids.has(id))) {
    throw new ReplanValidationError("UNKNOWN_IDS", "The replan references checklist IDs that do not exist on this Object. The proposal may contain invalid IDs or be outdated. Generate a new proposal.");
  }
  for (const item of existing) if (item.parentId && removed.has(item.parentId)) removed.add(item.id);
  if (sourceIds.some((id) => removed.has(id))) {
    throw new ReplanValidationError("KEEP_REMOVE_OVERLAP", "The replan both keeps and removes the same checklist item or its parent. Generate a new proposal.");
  }
  return { sourceIds: new Set(sourceIds), removed };
}

/** Complete AI omissions before preview, never silently delete unmentioned work. */
export function prepareReplanProposal<T extends Proposal>(proposal: T, existing: ChecklistItem[]): T {
  const { sourceIds, removed } = references(proposal, existing);
  const checklist = proposal.checklist.map((item) => ({ ...item, children: item.children.map((child) => ({ ...child })) }));
  const keep = (item: ChecklistItem): Item => ({
    sourceItemId: item.id, title: item.title, completed: item.completed, changeType: "keep", children: [],
  });
  const omitted = existing.filter((item) => !sourceIds.has(item.id) && !removed.has(item.id)).sort((a, b) => a.position - b.position);
  for (const item of omitted.filter((item) => item.parentId === null)) checklist.push(keep(item));
  for (const child of omitted.filter((item) => item.parentId !== null)) {
    const parent = checklist.find((item) => item.sourceItemId === child.parentId);
    if (!parent) {
      throw new ReplanValidationError("INVALID_HIERARCHY", "The replan moves a parent under another item but omits its children. Generate a new proposal with a one-level checklist.");
    }
    parent.children.push(keep(child));
  }
  const prepared = { ...proposal, checklist };
  validateReplanProposal(prepared, existing);
  return prepared;
}

/** Apply only the complete plan shown in the preview; do not repair at apply time. */
export function validateReplanProposal(proposal: Proposal, existing: ChecklistItem[]): void {
  const { sourceIds, removed } = references(proposal, existing);
  if (existing.some((item) => !sourceIds.has(item.id) && !removed.has(item.id))) {
    throw new ReplanValidationError("UNACCOUNTED_ITEMS", "The replan does not account for every existing checklist item. This may be an incomplete AI proposal, not a user edit. Generate a new proposal.");
  }
}