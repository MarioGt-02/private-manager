"use client";
import { RecurrenceForm } from "@/components/recurrence/RecurrenceForm";
import type { RecurrenceFormInput } from "@/lib/types/object";

/**
 * Draft recurrence editor. Operates only on RecurrenceFormInput (no persisted
 * seriesId / occurrence lineage), so it never fabricates recurrence identity.
 */
export function DraftRecurrenceEditor({ value, disabled, onChange }: {
  value: RecurrenceFormInput | null;
  disabled: boolean;
  onChange: (value: RecurrenceFormInput | null) => void;
}) {
  if (!value) {
    return <button type="button" className="btn-tertiary" disabled={disabled}
      onClick={() => onChange({ frequency: "yearly", interval: 1, basis: "scheduled_date", nextDate: null })}>+ Add recurrence</button>;
  }
  return <div className="space-y-2">
    <RecurrenceForm value={value} disabled={disabled} onChange={onChange} />
    <button type="button" className="btn-tertiary" disabled={disabled} onClick={() => onChange(null)}>Remove recurrence</button>
  </div>;
}
