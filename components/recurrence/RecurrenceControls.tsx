"use client";
import { useState } from "react";
import { RecurrenceForm, FREQUENCIES } from "./RecurrenceForm";
import type { RecurrenceBasis, RecurrenceConfig, RecurrenceFormInput, RecurrenceFrequency } from "@/lib/types/object";

export type { RecurrenceFormInput };

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
      <RecurrenceForm
        value={{ frequency, interval, basis, nextDate: nextDate || null }}
        disabled={disabled || busy}
        onChange={(next) => { setFrequency(next.frequency); setInterval(next.interval); setBasis(next.basis); setNextDate(next.nextDate ?? ""); }}
      />
      {error && <p role="alert" className="error-note">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={disabled || busy} onClick={() => void save()}>Save</button>
        <button type="button" className="btn-secondary" disabled={disabled || busy} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}

