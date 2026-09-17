"use client";
import { useContext, useState } from "react";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";
import { CategoryContext, mutateCategory } from "./CategoryContext";
import { CategoryColorPicker } from "./CategoryColorPicker";
import { colorStyle } from "@/lib/categories/colors";
import type { CategoryColor } from "@/lib/categories/model";

export function CategoryManager({ onClose }: { onClose: () => void }) {
  const { categories, loading, error: loadError, reload, saved } = useContext(CategoryContext);
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<CategoryColor>("blue");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <WorkspaceDialog label="Categories" onClose={onClose} busy={busy}>
    <header className="flex items-center justify-between border-b border-slate-200 p-5"><h2 className="font-semibold">Categories</h2><button className="btn-secondary" disabled={busy} onClick={onClose}>Close</button></header>
    <div className="min-h-0 space-y-5 overflow-y-auto p-5">
      {loading && <p role="status">Loading categories…</p>}
      {loadError && <p role="alert">{loadError} <button className="btn-secondary" onClick={reload}>Retry</button></p>}
      <ul className="divide-y divide-slate-100">{categories.map((category) => <li key={category.id}><button disabled={busy} className="flex w-full items-center gap-3 py-2 text-left text-sm" onClick={() => { setId(category.id); setName(category.name); setColor(category.color); setError(""); }}><span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colorStyle(category.color).accent }} /><span className="content-wrap">{category.name}</span><span className="ml-auto text-xs text-slate-500">Edit</span></button></li>)}</ul>
      <button className="btn-secondary" disabled={busy} onClick={() => { setId(null); setName(""); setColor("blue"); setError(""); }}>+ New category</button>
      <form className="space-y-4 border-t border-slate-200 pt-4" onSubmit={async (event) => {
        event.preventDefault(); if (busy) return; setBusy(true); setError("");
        try { const data = await mutateCategory({ action: id ? "update" : "create", ...(id ? { id } : {}), category: { name, color } }); saved(data.category); setId(null); setName(""); }
        catch (error) { setError((error as Error).message); } finally { setBusy(false); }
      }}>
        <h3 className="section-label">{id ? "Edit category" : "New category"}</h3>
        <label className="block text-sm">Name<input className="input mt-1" value={name} disabled={busy} maxLength={80} required onChange={(event) => setName(event.target.value)} /></label>
        <CategoryColorPicker value={color} onChange={setColor} disabled={busy} />
        {error && <p role="alert" className="error-note">{error}</p>}
        <button className="btn-primary" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save category"}</button>
      </form>
    </div>
  </WorkspaceDialog>;
}
