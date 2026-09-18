"use client";
import { useEffect, useRef, useState } from "react";
import { colorStyle } from "@/lib/categories/colors";
import { useObjectCategory } from "@/components/categories/CategoryContext";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";
import { COLUMNS, type ObjectStatus } from "@/lib/types/object";
import type { ArchivePage, ArchivedObjectSummary } from "@/lib/archive/schemas";
export function ArchivedRow({ object, onOpen, onRestore, onDelete, disabled }: { object: ArchivedObjectSummary; onOpen: () => void; onRestore: () => void; onDelete: () => void; disabled: boolean }) {
  const category = useObjectCategory(object);
  const [confirming, setConfirming] = useState(false);
  return <li className={`my-2 flex min-w-0 items-start gap-3 border-b border-l-[3px] border-slate-100 py-3 pl-3 ${object.cancelledAt ? "opacity-70" : ""}`} style={{ borderLeftColor: colorStyle(category?.color).accent }}>
    <button type="button" disabled={disabled} onClick={onOpen} className="min-w-0 flex-1 text-left">
      {category && <span className="mb-1 inline-block max-w-full truncate text-[10px] font-medium text-slate-500">{category.name}</span>}
      <p className={`content-wrap text-sm font-medium ${object.cancelledAt ? "text-slate-500 line-through" : "text-slate-800"}`}>{object.title}</p>
      <p className="mt-1 text-xs text-slate-500">Archived <time dateTime={object.archivedAt}>{new Date(object.archivedAt).toLocaleString()}</time></p>
      {object.cancelledAt && <span className="mt-2 inline-block rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600">Cancelled</span>}
    </button>
    <div className="flex shrink-0 flex-col items-end gap-2">
      {confirming ? <>
        <button type="button" disabled={disabled} className="btn-danger" aria-label="Confirm permanent deletion" onClick={onDelete}>确认删除</button>
        <button type="button" disabled={disabled} className="btn-secondary" aria-label="Keep Object" onClick={() => setConfirming(false)}>保留</button>
      </> : <>
        <button type="button" disabled={disabled} className="btn-secondary" onClick={onRestore}>Restore</button>
        <button type="button" disabled={disabled} className="btn-danger" aria-label="Delete Object permanently" title="永久删除" onClick={() => setConfirming(true)}>删除</button>
      </>}
    </div>
  </li>;
}
export function ArchiveDrawer({ status, version, onClose, onOpen, onRestore, onDelete }: {
  status: ObjectStatus; version: number; onClose: () => void; onOpen: (id: string) => Promise<void>; onRestore: (id: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState("completed");
  const filterLabel = (value: string) => (value === "all" ? "All" : value === "cancelled" ? "Cancelled" : status === "done" ? "Completed" : "Active");
  return <WorkspaceDialog label={`Archived — ${COLUMNS.find((column) => column.id === status)?.label}`} onClose={onClose}>
    <header className="flex items-center justify-between gap-3 border-b border-slate-200 p-5"><h2 className="text-base font-semibold">Archived — {COLUMNS.find((column) => column.id === status)?.label}</h2><button type="button" autoFocus className="btn-secondary" onClick={onClose}>Close</button></header>
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-3 flex gap-2">{(["all", "completed", "cancelled"] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? "btn-primary" : "btn-secondary"} onClick={() => setFilter(value)}>{filterLabel(value)}</button>)}</div>
      <ArchiveList key={`${status}:${filter}:${version}`} status={status} filter={filter} onOpen={onOpen} onRestore={onRestore} onDelete={onDelete} />
    </div>
  </WorkspaceDialog>;
}
function ArchiveList({ status, filter, onOpen, onRestore, onDelete }: { status: ObjectStatus; filter: string; onOpen: (id: string) => Promise<void>; onRestore: (id: string) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [page, setPage] = useState<ArchivePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/objects/archived?status=${status}&filter=${filter}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Unavailable");
      const result = await response.json(); if (!controller.signal.aborted) { setPage(result); setLoading(false); }
    }).catch(() => { if (!controller.signal.aborted) { setError("Could not load archived Objects."); setLoading(false); } });
    return () => controller.abort();
  }, [status, filter, retry]);
  async function perform(action: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setLoading(true); setError("");
    try { await action(); } catch { setError("Could not complete this action. Please try again."); }
    finally { lock.current = false; setLoading(false); }
  }
  return <div aria-busy={loading}>
    {loading && <p role="status" className="text-sm text-slate-500">Loading…</p>}
    {error && <div role="alert" className="error-note">{error}<button type="button" className="btn-tertiary" disabled={loading} onClick={() => { setError(""); setLoading(true); setRetry((value) => value + 1); }}>Retry</button></div>}
    {page && <><ul>{page.objects.map((object) => <ArchivedRow key={object.id} object={object} disabled={loading} onOpen={() => void perform(() => onOpen(object.id))} onRestore={() => void perform(() => onRestore(object.id))} onDelete={() => void perform(() => onDelete(object.id))} />)}</ul>
      {!page.objects.length && <p className="empty-note">No archived Objects here yet.</p>}
      {page.nextOffset !== null && <button type="button" className="btn-secondary mt-4" disabled={loading} onClick={() => void perform(async () => {
        const response = await fetch(`/api/objects/archived?status=${status}&filter=${filter}&offset=${page.nextOffset}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Unavailable");
        const next: ArchivePage = await response.json(); setPage({ objects: [...page.objects, ...next.objects], nextOffset: next.nextOffset });
      })}>Load More</button>}
    </>}
  </div>;
}
