import type { ManagedObject, RecurrenceBasis, RecurrenceFrequency } from "@/lib/types/object";
import type { TableColumnType } from "@/lib/tables/model";

/**
 * Client-safe AI types shared between the browser (AI Create UI) and the
 * server (AI routes). No server-only runtime imports.
 */

export type AIMessageRole = "user" | "assistant";

export interface AIConversationMessage {
  role: AIMessageRole;
  content: string;
}

/** A child checklist item. One level only — children never have children. */
export interface DraftChecklistChild {
  title: string;
  completed: boolean;
}

/** A top-level draft checklist item that may carry one level of children. */
export interface DraftChecklistItem {
  title: string;
  completed: boolean;
  children: DraftChecklistChild[];
}

/**
 * Draft-layer recurrence. Unlike RecurrenceFormInput, every field is optional
 * so the AI may propose partially known recurrence during clarification
 * (for example "yearly / every 1" while basis or scheduled date is still
 * unresolved) without discarding what it already knows.
 */
export interface DraftRecurrence {
  frequency?: RecurrenceFrequency | null;
  interval?: number | null;
  basis?: RecurrenceBasis | null;
  nextDate?: string | null;
}

/** A draft table column. `carryForward` means "keep this column's value next occurrence". */
export interface DraftTableColumn {
  name: string;
  type: TableColumnType;
  currency: string | null;
  carryForward: boolean;
}

/** A draft table row. `cells[i]` always corresponds to `columns[i]`; "" means empty. */
export interface DraftTableRow {
  carryForward: boolean;
  cells: string[];
}

/** A single AI-proposed table. V1 allows at most one per draft. */
export interface DraftTable {
  title: string;
  columns: DraftTableColumn[];
  rows: DraftTableRow[];
}

export interface CreateObjectDraft {
  categoryId?: string | null;
  title: string;
  goal: string;
  currentState: string;
  nextAction: string;
  checklist: DraftChecklistItem[];
  /** May be incomplete while clarifying; complete and valid before finalize. */
  recurrence?: DraftRecurrence | null;
  table?: DraftTable | null;
}

export type CreateObjectPhase = "clarifying" | "proposal";

export interface CreateObjectChatResponse {
  categories: import("@/lib/categories/suggestion").CategoryOption[];
  message: string;
  phase: CreateObjectPhase;
  draft: CreateObjectDraft | null;
}

export interface FinalizeCreateObjectResponse {
  object: ManagedObject;
}

export type APIErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_CREDENTIALS"
  | "AUTH_CONFIG_ERROR"
  | "INVALID_REQUEST"
  | "AI_UNAVAILABLE"
  | "AI_INVALID_RESPONSE"
  | "DRAFT_INVALID"
  | "DATABASE_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "OBJECT_NOT_FOUND"
  | "UPDATE_CONFLICT";

export interface APIErrorResponse {
  error: {
    code: APIErrorCode;
    message: string;
  };
}
