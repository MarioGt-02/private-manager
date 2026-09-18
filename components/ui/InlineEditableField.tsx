"use client";
import { useId, useRef, useState } from "react";

export function InlineEditableField({ label, value, onSave, multiline = false, maxLength, prominent = false, disabled = false, compact = false, boxed = false, emptyText = "Not set" }: {
  label: string; value: string; onSave: (value: string) => Promise<void>; multiline?: boolean;
  maxLength: number; prominent?: boolean; disabled?: boolean; compact?: boolean; boxed?: boolean; emptyText?: string;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function save() {
    if (lock.current || !draft.trim()) return;
    lock.current = true; setSaving(true); setError("");
    try { await onSave(draft.trim()); setEditing(false); }
    catch { setError("Could not save changes. Please try again."); }
    finally { lock.current = false; setSaving(false); }
  }
  function cancel() { if (!saving) { setEditing(false); setError(""); } }
  if (!editing && compact) return <div className="flex min-w-0 items-start gap-2"><p className="content-wrap flex-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{value}</p><button type="button" disabled={disabled} className="btn-tertiary" aria-label={`Edit ${label}`} onClick={() => { setDraft(value); setError(""); setEditing(true); }}>Edit</button></div>;
  if (!editing) return <div className="min-w-0">
    <div className="mb-1 flex items-center justify-between gap-3">
      <span className="section-label">{label}</span>
      <button type="button" disabled={disabled} className="btn-tertiary" aria-label={`Edit ${label}`}
        onClick={() => { setDraft(value); setError(""); setEditing(true); }}>Edit</button>
    </div>
    {boxed ? (
      <button type="button" disabled={disabled} aria-label={`Edit ${label}`} onClick={() => { setDraft(value); setError(""); setEditing(true); }}
        className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-slate-300">
        {value ? <span className="block min-h-[88px] whitespace-pre-wrap text-sm leading-6 text-slate-700">{value}</span> : <span className="block text-sm text-slate-400">{emptyText}</span>}
      </button>
    ) : (
      <p className={`content-wrap whitespace-pre-wrap ${prominent ? "text-xl font-semibold tracking-tight text-slate-900" : "text-sm leading-6 text-slate-700"}`}>{value || emptyText}</p>
    )}
  </div>;
  const inputProps = { id, value: draft, maxLength, autoFocus: true, disabled: saving,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    className: "input", "aria-describedby": error ? `${id}-error` : undefined };
  return <div className="space-y-2" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); }
  }}>
    <label htmlFor={id} className="section-label">{label}</label>
    {multiline ? <textarea {...inputProps} rows={3} /> : <input {...inputProps} />}
    {error && <p id={`${id}-error`} role="alert" className="error-note">{error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn-primary" disabled={saving || !draft.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
      <button type="button" className="btn-secondary" disabled={saving} onClick={cancel}>Cancel</button>
      <span className="text-xs text-slate-500">Ctrl / ⌘ + Enter to save</span>
    </div>
  </div>;
}
