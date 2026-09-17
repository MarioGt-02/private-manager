"use client";
import { useContext, useState } from "react";
import { CategoryContext } from "./CategoryContext";
import { CategoryManager } from "./CategoryManager";
export function CategorySelect({ value, disabled, onSave }: { value: string | null; disabled: boolean; onSave: (id: string | null) => Promise<void> }) {
  const { categories, loading, error: loadError, reload } = useContext(CategoryContext);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  return <section className="mb-5 space-y-2">
    <label className="block text-sm">Category<select className="input mt-1" aria-label="Category" value={value ?? ""} disabled={disabled || loading || !!loadError} onChange={async (event) => { setError(""); try { await onSave(event.target.value || null); } catch { setError("Could not save category. Please try again."); } }}>
      <option value="">No category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
    </select></label>
    {loading && <p role="status" className="text-xs text-slate-500">Loading categories…</p>}
    {loadError && <p role="alert" className="error-note">{loadError} <button onClick={reload} className="btn-tertiary">Retry</button></p>}
    {error && <p role="alert" className="error-note">{error}</p>}
    {!disabled && <button className="btn-tertiary" onClick={() => setManaging(true)}>+ New category</button>}
    {managing && <CategoryManager onClose={() => setManaging(false)} />}
  </section>;
}
