"use client";
import { useRef, useState } from "react";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";
import { ObjectDraftPreview } from "./ObjectDraftPreview";
import { ErrorDetails } from "@/components/ui/ErrorDetails";
import { localError, parseErrorDetail } from "@/lib/errors/client";
import type { ErrorDetail } from "@/lib/errors/types";
import type { CreateObjectDraft } from "@/lib/ai/types";
import type { ManagedObject } from "@/lib/types/object";
import type { CategoryOption } from "@/lib/categories/suggestion";

export function QuickCreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (object: ManagedObject) => void }) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<CreateObjectDraft | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<ErrorDetail | null>(null);
  const lock = useRef(false);

  if (!open) return null;

  async function generate() {
    if (lock.current || !text.trim()) return;
    lock.current = true;
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/create-object/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(parseErrorDetail(data, "Could not generate the Object. Please try again."));
        return;
      }
      setDraft(data.draft);
      setCategories(data.categories ?? []);
    } catch {
      setError(localError("Could not reach AI. Your text is still here."));
    } finally {
      lock.current = false;
      setGenerating(false);
    }
  }

  async function createObject() {
    if (!draft || lock.current) return;
    lock.current = true;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/create-object/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(parseErrorDetail(data, "Could not create the Object. Please try again."));
        return;
      }
      onCreated(data.object);
      setText("");
      setDraft(null);
      setCategories([]);
    } catch {
      setError(localError("Could not create the Object. Please try again."));
    } finally {
      lock.current = false;
      setCreating(false);
    }
  }

  return (
    <WorkspaceDialog label="Quick Create" onClose={onClose} busy={generating || creating}>
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <h2 className="text-base font-semibold text-slate-900">⚡ Quick Create</h2>
        <button type="button" disabled={generating || creating} autoFocus onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7">
        {error && <ErrorDetails detail={error} onDismiss={() => setError(null)} className="mb-4" />}
        {draft ? (
          <ObjectDraftPreview
            categories={categories}
            draft={draft}
            isCreating={creating}
            onChange={setDraft}
            onKeepDiscussing={() => setDraft(null)}
            keepLabel="Back to description"
            onCreate={createObject}
          />
        ) : (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              Describe the whole thing in one go.
              <textarea className="input mt-2" rows={10} maxLength={20000} value={text} disabled={generating} onChange={(event) => setText(event.target.value)} placeholder="Paste or type everything you have in mind…" />
            </label>
            <div className="flex justify-end">
              <button type="button" className="btn-primary" disabled={!text.trim() || generating} onClick={() => void generate()}>{generating ? "Generating…" : "Generate Object"}</button>
            </div>
          </div>
        )}
      </div>
    </WorkspaceDialog>
  );
}
