"use client";
import { useRef, useState } from "react";
import { formatEstimatedDuration, parseEstimatedDuration } from "@/lib/estimates/time";

export function EstimateEditor({ title, value, disabled, onSave }: { title: string; value: number | null; disabled?: boolean; onSave: (minutes: number | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function save(clear = false) {
    if (lock.current || disabled) return;
    let minutes;
    try {
      if (!clear && !draft.trim()) throw new Error("Enter a duration or choose Clear estimate.");
      minutes = clear ? null : parseEstimatedDuration(draft);
    } catch (error) { setError(error instanceof Error ? error.message : "Invalid duration."); return; }
    lock.current = true; setBusy(true); setError("");
    try { await onSave(minutes); setEditing(false); }
    catch { setError("Could not save the estimate. Please retry."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className={`min-w-0 ${editing ? "w-full" : "shrink-0"}`}>
    {!editing ? <button type="button" aria-label={`Edit estimate: ${title}`} title="Approximate active work effort" disabled={disabled} className="min-h-11 min-w-11 rounded px-2 text-xs tabular-nums text-slate-500 hover:bg-slate-100 disabled:opacity-50 sm:min-h-8" onClick={() => { setDraft(value === null ? "" : formatEstimatedDuration(value)); setError(""); setEditing(true); }}>{value === null ? "—" : `≈ ${formatEstimatedDuration(value)}`}</button> : <div className="flex min-w-0 flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 p-2">
      <label className="min-w-0 flex-1 text-xs text-slate-600">Active effort<input autoFocus aria-label={`Estimated duration: ${title}`} value={draft} disabled={disabled || busy} maxLength={30} onChange={(event) => setDraft(event.target.value)} placeholder="1h 30m" className="input mt-1 w-full min-w-0" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void save(); } if (event.key === "Escape") setEditing(false); }} /></label>
      <div className="flex flex-wrap gap-1">
        <button type="button" className="btn-secondary min-h-11" disabled={disabled || busy} onClick={() => void save()}>Save estimate</button>
        <button type="button" className="btn-tertiary min-h-11" disabled={disabled || busy} onClick={() => void save(true)}>Clear estimate</button>
        <button type="button" className="btn-tertiary min-h-11" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
      </div>
      {error && <p role="alert" className="w-full text-xs text-red-600">{error}</p>}
    </div>}
  </div>;
}