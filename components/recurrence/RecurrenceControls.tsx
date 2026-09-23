"use client";
import { useState } from "react";
import type { RecurrenceBasis, RecurrenceConfig, RecurrenceFrequency } from "@/lib/types/object";

const FREQUENCIES: { value: RecurrenceFrequency; label: string }[] = [
  { value: "daily", label: "Day" },
  { value: "weekly", label: "Week" },
  { value: "monthly", label: "Month" },
  { value: "yearly", label: "Year" },
];

export interface RecurrenceFormInput {
  frequency: RecurrenceFrequency;
  interval: number;
  basis: RecurrenceBasis;
  nextDate: string | null;
}

export function RecurrenceControls({ config, disabled, onSave }: { config: RecurrenceConfig | null; disabled: boolean; onSave: (config: RecurrenceFormInput | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(config?.frequency ?? "monthly");
  const [interval, setInterval] = useState<number>(config?.interval ?? 1);
  const [basis, setBasis] = useState<RecurrenceBasis>(config?.basis ?? "scheduled_date");
  const [nextDate, setNextDate] = useState<string>(config?.nextDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!Number.isInteger(interval) || interval < 1 || interval > 100) { setError("Interval must be 1–100."); return; }
    setBusy(true);
    setError("");
    try {
      await onSave({ frequency, interval, basis, nextDate: nextDate || null });
      setEditing(false);
    } catch {
      setError("Could not save recurrence.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError("");
    try {
      await onSave(null);
      setEditing(false);
    } catch {
      setError("Could not stop recurrence.");
    } finally {
      setBusy(false);
    }
  }

  if (!config && !editing) {
    return <button type="button" className="btn-tertiary" disabled={disabled} onClick={() => setEditing(true)}>+ Make recurring</button>;
  }

  if (!editing) {
    const unit = FREQUENCIES.find((item) => item.value === config!.frequency)?.label.toLowerCase() ?? config!.frequency;
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-700">Every {config!.interval} {unit}{config!.interval === 1 ? "" : "s"}</p>
        <p className="text-xs text-slate-500">{config!.basis === "scheduled_date" ? "Scheduled date" : "From completion date"}{config!.nextDate ? ` · Next ${config!.nextDate}` : ""}</p>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" disabled={disabled || busy} onClick={() => { setFrequency(config!.frequency); setInterval(config!.interval); setBasis(config!.basis); setNextDate(config!.nextDate ?? ""); setEditing(true); }}>Edit</button>
          <button type="button" className="btn-tertiary" disabled={disabled || busy} onClick={() => void stop()}>Stop recurrence</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-600">Every</span>
        <input type="number" min={1} max={100} value={interval} disabled={disabled || busy} onChange={(event) => setInterval(Number(event.target.value))} className="input w-20" aria-label="Interval" />
        <select value={frequency} disabled={disabled || busy} onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)} className="input" aria-label="Frequency">
          {FREQUENCIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
      <div className="space-y-1 text-sm">
        <label className="flex items-center gap-2"><input type="radio" name="recurrence-basis" checked={basis === "scheduled_date"} onChange={() => setBasis("scheduled_date")} disabled={disabled || busy} /> Scheduled date</label>
        <label className="flex items-center gap-2"><input type="radio" name="recurrence-basis" checked={basis === "completion_date"} onChange={() => setBasis("completion_date")} disabled={disabled || busy} /> Completion date</label>
      </div>
      {basis === "scheduled_date" && (
        <label className="block text-sm"><span className="text-slate-600">Next occurrence</span><input type="date" value={nextDate} disabled={disabled || busy} onChange={(event) => setNextDate(event.target.value)} className="input mt-1" /></label>
      )}
      {error && <p role="alert" className="error-note">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={disabled || busy} onClick={() => void save()}>Save</button>
        <button type="button" className="btn-secondary" disabled={disabled || busy} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}
