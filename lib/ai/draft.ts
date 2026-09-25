import type { RecurrenceFormInput } from "@/lib/types/object";
import type { DraftRecurrence } from "./types";

/** Complete a partial DraftRecurrence into an editable RecurrenceFormInput, or null. */
export function recurrenceToFormInput(value: DraftRecurrence | null | undefined): RecurrenceFormInput | null {
  if (!value || !value.frequency || !value.basis) return null;
  const interval = value.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1) return null;
  return { frequency: value.frequency, interval, basis: value.basis, nextDate: value.nextDate ?? null };
}

export function formInputToDraftRecurrence(value: RecurrenceFormInput | null): DraftRecurrence | null {
  if (!value) return null;
  return { frequency: value.frequency, interval: value.interval, basis: value.basis, nextDate: value.nextDate };
}

/**
 * Preserve a draft across conversational turns: a clarifying response that
 * carries no draft must not erase the partial draft already built up.
 */
export function mergeChatDraft<T>(previous: T | null, next: T | null): T | null {
  return next ?? previous;
}
