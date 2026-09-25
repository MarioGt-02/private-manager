"use client";
import { useEffect, useRef, useState } from "react";
import { COLUMNS, type ObjectStatus } from "@/lib/types/object";

interface DepEntry {
  objectId: string;
  title: string;
  status: ObjectStatus;
  resolved: boolean;
}

interface Deps {
  blockedBy: DepEntry[];
  blocking: DepEntry[];
}

export function DependenciesSection({ objectId, disabled, onOpenObject }: { objectId: string; disabled: boolean; onOpenObject: (id: string) => void }) {
  const [deps, setDeps] = useState<Deps | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<DepEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch(`/api/objects/${encodeURIComponent(objectId)}/dependencies`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (active) {
          setDeps(data.dependencies);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError("Could not load dependencies.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [objectId]);

  useEffect(() => {
    if (!pickerOpen || !query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/objects/${encodeURIComponent(objectId)}/dependencies/search?q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error();
          const data = await res.json();
          if (!controller.signal.aborted) setCandidates(data.candidates);
        })
        .catch(() => {
          if (!controller.signal.aborted) setCandidates([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, pickerOpen, objectId]);

  async function add(id: string) {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/objects/${encodeURIComponent(objectId)}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dependsOnObjectId: id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not add dependency.");
      setDeps(data.dependencies);
      setPickerOpen(false);
      setQuery("");
      setCandidates([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add dependency.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/objects/${encodeURIComponent(objectId)}/dependencies`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dependsOnObjectId: id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not remove dependency.");
      setDeps(data.dependencies);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove dependency.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-label="Dependencies" className="mt-4 border-t border-slate-200 pt-3">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="section-label">Dependencies</h3>
        {!disabled && (
          <button type="button" className="btn-tertiary" disabled={busy} onClick={() => { if (pickerOpen) { setPickerOpen(false); setQuery(""); setCandidates([]); } else { setPickerOpen(true); } }}>+ Add dependency</button>
        )}
      </div>

      {loading && <p role="status" className="text-xs text-slate-500">Loading…</p>}
      {error && <p role="alert" className="error-note">{error}</p>}

      {deps && (
        <>
          <div className="lg:grid lg:grid-cols-2 lg:gap-x-6">
            <DepGroup label="Blocked by" entries={deps.blockedBy} onOpen={onOpenObject} onRemove={disabled ? undefined : remove} />
            <DepGroup label="Blocking" entries={deps.blocking} onOpen={onOpenObject} />
          </div>
          {!deps.blockedBy.length && !deps.blocking.length && !loading && <p className="py-1 text-sm text-slate-400">No dependencies yet.</p>}
        </>
      )}

      {pickerOpen && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2">
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Objects by title…" className="input" aria-label="Search Objects" />
          {searching && <p className="mt-1 text-xs text-slate-500">Searching…</p>}
          {!searching && query.trim() && (
            <ul className="mt-1 max-h-48 overflow-y-auto">
              {candidates.map((candidate) => (
                <li key={candidate.objectId}>
                  <button type="button" disabled={busy} onClick={() => void add(candidate.objectId)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-slate-100 disabled:opacity-50">
                    <span aria-hidden="true">{candidate.resolved ? "✓" : "🔒"}</span>
                    <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                    <span className="text-xs text-slate-500">{COLUMNS.find((column) => column.id === candidate.status)?.label ?? candidate.status}</span>
                  </button>
                </li>
              ))}
              {!candidates.length && <li className="px-2 py-1 text-xs text-slate-500">No matching Objects.</li>}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function DepGroup({ label, entries, onOpen, onRemove }: { label: string; entries: DepEntry[]; onOpen: (id: string) => void; onRemove?: (id: string) => void }) {
  if (!entries.length) return null;
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <ul className="mt-1 space-y-1">
        {entries.map((entry) => (
          <li key={entry.objectId} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
            <button type="button" onClick={() => onOpen(entry.objectId)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
              <span aria-hidden="true">{entry.resolved ? "✓" : "🔒"}</span>
              <span className="min-w-0 flex-1 truncate text-slate-700">{entry.title}</span>
              <span className="text-xs text-slate-500">{COLUMNS.find((column) => column.id === entry.status)?.label ?? entry.status}</span>
            </button>
            {onRemove && (
              <button type="button" aria-label={`Remove dependency on ${entry.title}`} onClick={() => void onRemove(entry.objectId)} className="rounded p-0.5 text-slate-400 hover:text-red-600">×</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

