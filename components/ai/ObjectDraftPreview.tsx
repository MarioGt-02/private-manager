"use client";

import type { ReactNode } from "react";
import type { CreateObjectDraft, DraftChecklistItem } from "@/lib/ai/types";
import type { CategoryOption } from "@/lib/categories/suggestion";

interface ObjectDraftPreviewProps {
  categories?: CategoryOption[];
  draft: CreateObjectDraft;
  isCreating: boolean;
  onChange: (draft: CreateObjectDraft) => void;
  onKeepDiscussing: () => void;
  onCreate: () => void;
}

export function ObjectDraftPreview({
  categories = [],
  draft,
  isCreating,
  onChange,
  onKeepDiscussing,
  onCreate,
}: ObjectDraftPreviewProps) {
  function updateField<K extends keyof CreateObjectDraft>(key: K, value: CreateObjectDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  function updateChecklist(checklist: DraftChecklistItem[]) {
    onChange({ ...draft, checklist });
  }

  function updateTop(index: number, patch: Partial<Omit<DraftChecklistItem, "children">>) {
    updateChecklist(draft.checklist.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function updateChild(parentIndex: number, childIndex: number, patch: Partial<DraftChecklistItem["children"][number]>) {
    updateChecklist(
      draft.checklist.map((item, i) =>
        i === parentIndex
          ? { ...item, children: item.children.map((child, ci) => (ci === childIndex ? { ...child, ...patch } : child)) }
          : item,
      ),
    );
  }

  function addTop() {
    updateChecklist([...draft.checklist, { title: "", completed: false, children: [] }]);
  }

  function addChild(parentIndex: number) {
    updateChecklist(
      draft.checklist.map((item, i) =>
        i === parentIndex ? { ...item, children: [...item.children, { title: "", completed: false }] } : item,
      ),
    );
  }

  function removeTop(index: number) {
    updateChecklist(draft.checklist.filter((_, i) => i !== index));
  }

  function removeChild(parentIndex: number, childIndex: number) {
    updateChecklist(
      draft.checklist.map((item, i) =>
        i === parentIndex ? { ...item, children: item.children.filter((_, ci) => ci !== childIndex) } : item,
      ),
    );
  }

  const canCreate =
    [draft.title, draft.goal, draft.currentState, draft.nextAction].every((value) => value.trim()) &&
    draft.checklist.some((item) => item.title.trim());

  return (
    <fieldset disabled={isCreating} className="flex min-w-0 flex-col gap-5">
      <div>
        <p className="mb-2 text-sm font-medium text-slate-500">Review and edit the proposal before creating.</p>
      </div>

      <Field label="Title">
        <input maxLength={120} value={draft.title} onChange={(event) => updateField("title", event.target.value)} className={inputClass} />
      </Field>

      <Field label="Category">
        <select aria-label="Category" className={inputClass} value={draft.categoryId ?? ""} onChange={(event) => updateField("categoryId", event.target.value || null)}>
          <option value="">No category</option>
          {draft.categoryId && !categories.some((category) => category.id === draft.categoryId) && <option value={draft.categoryId} disabled>Unavailable category — choose another</option>}
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <span className="mt-1 block text-xs text-slate-500">AI suggestion only. You can change or clear it before creating.</span>
      </Field>

      <Field label="Goal">
        <textarea maxLength={1000} value={draft.goal} onChange={(event) => updateField("goal", event.target.value)} rows={2} className={inputClass} />
      </Field>

      <Field label="Current State">
        <textarea maxLength={1000} value={draft.currentState} onChange={(event) => updateField("currentState", event.target.value)} rows={2} className={inputClass} />
      </Field>

      <Field label="Next Action">
        <input maxLength={500} value={draft.nextAction} onChange={(event) => updateField("nextAction", event.target.value)} className={inputClass} />
      </Field>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Checklist</span>
          <button type="button" disabled={draft.checklist.length >= 20 || isCreating} onClick={addTop} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-40">
            + Add item
          </button>
        </div>

        <ul className="space-y-1">
          {draft.checklist.map((item, index) => (
            <li key={index}>
              <div className="flex items-center gap-2">
                <input
                  aria-label={`Complete draft item ${index + 1}`}
                  type="checkbox"
                  checked={item.completed}
                  disabled={item.children.length > 0 || isCreating}
                  onChange={(event) => updateTop(index, { completed: event.target.checked })}
                  className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-default"
                />
                <input
                  maxLength={300}
                  value={item.title}
                  onChange={(event) => updateTop(index, { title: event.target.value })}
                  aria-label={`Draft checklist item ${index + 1}`}
                  placeholder="Checklist item"
                  className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-700 outline-none focus:border-indigo-400"
                />
                <button type="button" disabled={isCreating} onClick={() => addChild(index)} aria-label={`Add sub-item to ${item.title || "item"}`} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-600">↳</button>
                <button type="button" onClick={() => removeTop(index)} aria-label="Remove checklist item" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-600">×</button>
              </div>

              {item.children.length > 0 && (
                <ul className="ml-6 space-y-1">
                  {item.children.map((child, childIndex) => (
                    <li key={childIndex} className="flex items-center gap-2">
                      <input
                        aria-label={`Complete draft sub-item ${childIndex + 1}`}
                        type="checkbox"
                        checked={child.completed}
                        onChange={(event) => updateChild(index, childIndex, { completed: event.target.checked })}
                        className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <input
                        maxLength={300}
                        value={child.title}
                        onChange={(event) => updateChild(index, childIndex, { title: event.target.value })}
                        aria-label={`Draft sub-item ${childIndex + 1}`}
                        placeholder="Sub-item"
                        className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-700 outline-none focus:border-indigo-400"
                      />
                      <button type="button" onClick={() => removeChild(index, childIndex)} aria-label="Remove sub-item" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-600">×</button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white py-3">
        <button type="button" onClick={onKeepDiscussing} disabled={isCreating} className="btn-secondary">Keep Discussing</button>
        <button type="button" onClick={onCreate} disabled={isCreating || !canCreate} className="btn-primary">{isCreating ? "Creating…" : "Create Object"}</button>
      </div>
    </fieldset>
  );
}

const inputClass = "input";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      {children}
    </label>
  );
}
