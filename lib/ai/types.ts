import type { ManagedObject } from "@/lib/types/object";

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

export interface CreateObjectDraft {
  categoryId?: string | null;
  title: string;
  goal: string;
  currentState: string;
  nextAction: string;
  checklist: DraftChecklistItem[];
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
