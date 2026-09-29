import type { ChecklistItem } from "@/lib/types/object";

export const ESTIMATE_MINUTES_MIN = 1;
export const ESTIMATE_MINUTES_MAX = 525600;

export function validateEstimatedMinutes(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < ESTIMATE_MINUTES_MIN || value > ESTIMATE_MINUTES_MAX) {
    throw new Error(`Estimated minutes must be an integer from ${ESTIMATE_MINUTES_MIN} to ${ESTIMATE_MINUTES_MAX}.`);
  }
  return value;
}

export function parseEstimatedDuration(input: string, options: { allowClear?: boolean } = {}): number | null {
  const value = input.trim().toLowerCase();
  if (!value) {
    if (options.allowClear) return null;
    throw new Error("Enter a duration or choose Clear estimate.");
  }
  const match = value.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (!match || (!match[1] && !match[2])) throw new Error("Use a duration such as 15m, 1h, or 1h 30m.");
  const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  return validateEstimatedMinutes(minutes);
}

export function formatEstimatedDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${minutes}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export function getActionableLeaves(items: ChecklistItem[]): ChecklistItem[] {
  const parentIds = new Set(items.filter((item) => item.parentId !== null).map((item) => item.parentId));
  return items.filter((item) => !parentIds.has(item.id));
}

export interface EstimateSummary {
  hasEstimates: boolean;
  estimatedTotalMinutes: number;
  estimatedDoneMinutes: number;
  estimatedRemainingMinutes: number;
  unestimatedCount: number;
}

export function summarizeEstimates(items: ChecklistItem[]): EstimateSummary {
  const leaves = getActionableLeaves(items);
  let total = 0;
  let done = 0;
  let unestimatedCount = 0;
  for (const item of leaves) {
    if (item.estimatedMinutes == null) {
      unestimatedCount += 1;
      continue;
    }
    total += item.estimatedMinutes;
    if (item.completed) done += item.estimatedMinutes;
  }
  return { hasEstimates: total > 0, estimatedTotalMinutes: total, estimatedDoneMinutes: done, estimatedRemainingMinutes: total - done, unestimatedCount };
}