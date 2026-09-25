"use client";
import { useId } from "react";
import type { RecurrenceFormInput, RecurrenceFrequency } from "@/lib/types/object";

export const FREQUENCIES: { value: RecurrenceFrequency; label: string }[] = [
  { value: "daily", label: "Day" },
  { value: "weekly", label: "Week" },
  { value: "monthly", label: "Month" },
  { value: "yearly", label: "Year" },
];

/**
 * Pure controlled recurrence form over RecurrenceFormInput. It knows nothing
 * about persisted recurrence identity (seriesId / occurrence lineage), so both
 * the persisted RecurrenceControls and the AI draft editor can share it.
 */
export function RecurrenceForm({ value, disabled, onChange }: {
  value: RecurrenceFormInput;
  disabled: boolean;
  onChange: (value: RecurrenceFormInput) => void;
}) {
  const id = useId();
  const basisName = `recurrence-basis-${id}`;
  return <div className="space-y-2">
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-600">Every</span>
      <input type="number" min={1} max={100} value={value.interval} disabled={disabled}
        onChange={(event) => onChange({ ...value, interval: Number(event.target.value) })}
        className="input w-20" aria-label="Interval" />
      <select value={value.frequency} disabled={disabled}
        onChange={(event) => onChange({ ...value, frequency: event.target.value as RecurrenceFrequency })}
        className="input" aria-label="Frequency">
        {FREQUENCIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </div>
    <div className="space-y-1 text-sm">
      <label className="flex items-center gap-2"><input type="radio" name={basisName} checked={value.basis === "scheduled_date"} onChange={() => onChange({ ...value, basis: "scheduled_date" })} disabled={disabled} /> Scheduled date</label>
      <label className="flex items-center gap-2"><input type="radio" name={basisName} checked={value.basis === "completion_date"} onChange={() => onChange({ ...value, basis: "completion_date" })} disabled={disabled} /> Completion date</label>
    </div>
    {value.basis === "scheduled_date" && (
      <label className="block text-sm"><span className="text-slate-600">Next occurrence</span>
        <input type="date" value={value.nextDate ?? ""} disabled={disabled} onChange={(event) => onChange({ ...value, nextDate: event.target.value || null })} className="input mt-1" aria-label="Next occurrence" />
      </label>
    )}
  </div>;
}
