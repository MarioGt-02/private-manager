/**
 * Core domain types for Private Manager.
 *
 * Terminology note: a "ManagedObject" is one complete thing, outcome, or goal
 * (e.g. "Make a table"). It is NOT an individual task. We intentionally avoid
 * the names Task / TaskCard / TaskList / TaskManager throughout the codebase.
 */
export const STATUSES = ["idea", "ready", "doing", "waiting", "done"] as const;

export type ObjectStatus = (typeof STATUSES)[number];

export interface ChecklistItem {
  id: string;
  parentId: string | null;
  title: string;
  completed: boolean;
  position: number;
}

export interface ManagedObject {
  id: string;
  title: string;
  status: ObjectStatus;
  position: number;
  category: string | null;
  categoryId?: string | null;
  archivedAt: string | null;
  cancelledAt: string | null;
  goal: string;
  currentState: string;
  nextAction: string;
  checklist: ChecklistItem[];
  unresolvedDependencies: number;
}

export interface ColumnDefinition {
  id: ObjectStatus;
  label: string;
  emoji: string;
}

export const COLUMNS: ColumnDefinition[] = [
  { id: "idea", label: "Idea", emoji: "💡" },
  { id: "ready", label: "Ready", emoji: "📋" },
  { id: "doing", label: "Doing", emoji: "🔨" },
  { id: "waiting", label: "Waiting", emoji: "⏸" },
  { id: "done", label: "Done", emoji: "✅" },
];

export function isStatus(value: string): value is ObjectStatus {
  return (STATUSES as readonly string[]).includes(value);
}

