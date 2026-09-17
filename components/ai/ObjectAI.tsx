"use client";
import { useRef, useState } from "react";
import type { z } from "zod";
import { progressUpdateSchema } from "@/lib/ai/progress";
import { replanProposalSchema } from "@/lib/ai/replan";
import type { ManagedObject } from "@/lib/types/object";
import { deriveNextAction } from "@/lib/objects/next-action";
import { ErrorDetails } from "@/components/ui/ErrorDetails";
import { ApiError, localError, parseErrorDetail } from "@/lib/errors/client";
import type { ErrorDetail } from "@/lib/errors/types";

type Progress = z.infer<typeof progressUpdateSchema>;
type Replan = z.infer<typeof replanProposalSchema>;

export function ValueChange({ label, before, after }: { label: string; before: string; after: string }) {
  return <div className="min-w-0 space-y-1">
    <p className="section-label">{label}</p>
    {before !== after && <p className="content-wrap whitespace-pre-wrap text-sm text-slate-500"><span className="font-medium">Before: </span>{before || "Not set"}</p>}
    <p className="content-wrap whitespace-pre-wrap text-sm leading-6 text-slate-800"><span className="font-medium">After: </span>{after}</p>
  </div>;
}
export function progressNextAction(object: ManagedObject, update: Progress): string {
  const existing = object.checklist.map((item) => ({ ...item,
    completed: update.completedItemIds.includes(item.id) ? true : update.reopenedItemIds.includes(item.id) ? false : item.completed,
  }));
  const newItems = update.newChecklistItems.map((item) => {
    const parentId = item.parentItemId ?? null;
    const siblings = existing.filter((e) => (parentId ? e.parentId === parentId : e.parentId === null));
    const maxPos = siblings.reduce((max, sibling) => Math.max(max, sibling.position), -1);
    return { id: `new-${Math.random().toString(36).slice(2)}`, title: item.title, completed: false, position: maxPos + 1, parentId };
  });
  return deriveNextAction([...existing, ...newItems]);
}
export function ProgressDiff({ object, update }: { object: ManagedObject; update: Progress }) {
  const title = (id: string) => object.checklist.find((item) => item.id === id)?.title ?? "Checklist item no longer available";
  return <div className="preview-panel">
    <h4 className="text-sm font-semibold">Review progress update</h4>
    <ValueChange label="Current State" before={object.currentState} after={update.currentState} />
    <ValueChange label="Next Action after apply" before={object.nextAction} after={progressNextAction(object, update)} />
    <div><p className="section-label mb-2">Checklist changes</p>
      {!update.completedItemIds.length && !update.reopenedItemIds.length && !update.newChecklistItems.length && <p className="text-sm text-slate-500">No checklist changes.</p>}
      <ul className="space-y-2 text-sm">
        {update.completedItemIds.map((id) => <li className="content-wrap" key={id}><span className="font-medium text-green-800">✓ Complete: </span>{title(id)}</li>)}
        {update.reopenedItemIds.map((id) => <li className="content-wrap" key={id}><span className="font-medium text-amber-800">↺ Reopen: </span>{title(id)}</li>)}
        {update.newChecklistItems.map((item, i) => { const parentTitle = item.parentItemId ? object.checklist.find((c) => c.id === item.parentItemId)?.title : null; return <li className="content-wrap" key={i}><span className="font-medium text-blue-700">+ Add: </span>{item.title}{parentTitle ? <span className="text-slate-400"> · under “{parentTitle}”</span> : null}</li>; })}
      </ul>
    </div>
    <p className="content-wrap text-xs leading-5 text-slate-500">{update.summary}</p>
  </div>;
}
export function ReplanDiff({ object, proposal }: { object: ManagedObject; proposal: Replan }) {
  const oldTitle = (id: string | null) => object.checklist.find((item) => item.id === id)?.title ?? "Checklist item no longer available";
  const color = (changeType: string) => (changeType === "add" ? "text-green-800" : changeType === "modify" ? "text-blue-700" : "text-slate-500");
  const flat: { id: string; title: string; completed: boolean; position: number; parentId: string | null }[] = [];
  proposal.checklist.forEach((item, ti) => {
    const parentId = item.sourceItemId ?? `new-${ti}`;
    flat.push({ id: parentId, title: item.title, completed: item.completed, position: ti, parentId: null });
    item.children.forEach((child, ci) => flat.push({ id: child.sourceItemId ?? `new-${ti}-${ci}`, title: child.title, completed: child.completed, position: ci, parentId }));
  });
  return <div className="preview-panel">
    <h4 className="text-sm font-semibold">Review replan</h4>
    <p className="content-wrap text-sm leading-6 text-slate-700">{proposal.reasonSummary}</p>
    {proposal.title !== null && <ValueChange label="Title" before={object.title} after={proposal.title} />}
    {proposal.goal !== null && <ValueChange label="Goal" before={object.goal} after={proposal.goal} />}
    <ValueChange label="Current State" before={object.currentState} after={proposal.currentState} />
    <ValueChange label="Next Action after apply" before={object.nextAction} after={deriveNextAction(flat)} />
    <div className="space-y-2"><p className="section-label">Checklist changes</p>
      {proposal.checklist.map((item, index) => (
        <div key={index} className="space-y-1">
          <div className="content-wrap rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <span className={`text-[11px] font-semibold tracking-wide ${color(item.changeType)}`}>{item.changeType.toUpperCase()}</span>
            {item.changeType === "modify" ? <><p className="mt-1 text-slate-500">Old: {oldTitle(item.sourceItemId)}</p><p className="mt-1">New: {item.title}</p></> : <p className="mt-1">{item.completed ? "✓ " : "○ "}{item.title}</p>}
          </div>
          {item.children.length > 0 && (
            <div className="ml-6 space-y-1">
              {item.children.map((child, ci) => (
                <div key={ci} className="content-wrap rounded-lg border border-slate-200 bg-white p-2 text-sm">
                  <span className={`text-[11px] font-semibold tracking-wide ${color(child.changeType)}`}>{child.changeType.toUpperCase()}</span>
                  {child.changeType === "modify" ? <><p className="mt-1 text-slate-500">Old: {oldTitle(child.sourceItemId)}</p><p className="mt-1">New: {child.title}</p></> : <p className="mt-1">{child.completed ? "✓ " : "○ "}{child.title}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {proposal.removedItemIds.map((id) => (
        <div key={id} className="content-wrap rounded-lg border border-red-100 bg-red-50 p-3 text-sm"><span className="text-[11px] font-semibold text-red-800">REMOVE</span><p className="mt-1">{oldTitle(id)}</p></div>
      ))}
    </div>
    <div><p className="section-label mb-2">Final checklist · {flat.length} items</p><ol className="list-inside list-decimal space-y-2 text-sm">{flat.map((item, i) => <li key={i} className={`content-wrap ${item.parentId ? "ml-6" : ""}`}>{item.completed ? "✓ " : "○ "}{item.title}</li>)}</ol></div>
    <p className="content-wrap text-xs leading-5 text-slate-500">{proposal.summary}</p>
  </div>;
}

export function ObjectAI({ object, onApplyProgress, onApplyReplan, disabled, onPendingChange }: {
  object: ManagedObject; disabled: boolean; onPendingChange: (pending: boolean) => void;
  onApplyProgress: (id: string, update: unknown) => Promise<void>;
  onApplyReplan: (id: string, proposal: unknown) => Promise<void>;
}) {
  const [mode, setMode] = useState<"progress" | "replan">("progress");
  return <section aria-label="AI" className="space-y-3">
    <h3 className="section-label">AI assistance</h3>
    <div className="flex flex-wrap gap-2" aria-label="AI operation">
      <button className={mode === "progress" ? "btn-primary" : "btn-secondary"} type="button" disabled={disabled} aria-pressed={mode === "progress"} onClick={() => setMode("progress")}>Update Progress</button>
      <button className={mode === "replan" ? "btn-primary" : "btn-secondary"} type="button" disabled={disabled} aria-pressed={mode === "replan"} onClick={() => setMode("replan")}>Replan</button>
    </div>
    <div hidden={mode !== "progress"}><AnalysisPanel kind="progress" object={object} disabled={disabled} onPendingChange={onPendingChange} onApply={onApplyProgress} /></div>
    <div hidden={mode !== "replan"}><AnalysisPanel kind="replan" object={object} disabled={disabled} onPendingChange={onPendingChange} onApply={onApplyReplan} /></div>
  </section>;
}
function AnalysisPanel({ kind, object, onApply, disabled, onPendingChange }: {
  kind: "progress" | "replan"; object: ManagedObject; disabled: boolean;
  onPendingChange: (pending: boolean) => void; onApply: (id: string, value: unknown) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Progress | Replan | null>(null);
  const [busy, setBusy] = useState<"analyze" | "apply" | null>(null);
  const [error, setError] = useState<ErrorDetail | null>(null);
  const lock = useRef(false);
  async function run(operation: "analyze" | "apply") {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(operation); setError(null); onPendingChange(true);
    try {
      if (operation === "apply") {
        if (!preview) return;
        await onApply(object.id, preview); setPreview(null); setMessage("");
      } else {
        const response = await fetch(`/api/ai/objects/${encodeURIComponent(object.id)}/${kind}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: message.trim() }) });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new ApiError(parseErrorDetail(data, `Could not analyze ${kind === "progress" ? "progress" : "replan"}. Please try again.`));
        setPreview(kind === "progress" ? progressUpdateSchema.parse(data.update) : replanProposalSchema.parse(data.proposal));
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.detail : localError(operation === "analyze" ? `Could not analyze ${kind === "progress" ? "progress" : "replan"}. Please try again.` : `Could not apply ${kind === "progress" ? "update" : "replan"}. Your preview is still here.`));
    } finally { lock.current = false; setBusy(null); onPendingChange(false); }
  }
  return <div className="space-y-3" aria-busy={!!busy}>
    <p className="text-xs leading-5 text-slate-500">{kind === "progress" ? "Tell AI what happened. Review the proposed changes before applying." : "Explain what changed. Review the plan diff before applying."}</p>
    {!preview ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void run("analyze"); }}>
      <label className="block text-sm font-medium text-slate-700">{kind === "progress" ? "What happened?" : "What changed?"}
        <textarea className="input mt-2" rows={3} maxLength={4000} value={message} disabled={disabled || !!busy} onChange={(event) => setMessage(event.target.value)} />
      </label>
      <button type="submit" className="btn-primary" disabled={disabled || !!busy || !message.trim()}>{busy === "analyze" ? "Analyzing…" : kind === "progress" ? "Analyze Progress" : "Analyze Replan"}</button>
    </form> : <>
      {kind === "progress" ? <ProgressDiff object={object} update={preview as Progress} /> : <ReplanDiff object={object} proposal={preview as Replan} />}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={disabled || !!busy} onClick={() => void run("apply")}>{busy === "apply" ? "Applying…" : kind === "progress" ? "Apply Update" : "Apply Replan"}</button>
        <button type="button" className="btn-secondary" disabled={disabled || !!busy} onClick={() => { setPreview(null); setError(null); }}>Back</button>
        <button type="button" className="btn-tertiary" disabled={disabled || !!busy} onClick={() => { setPreview(null); setError(null); }}>Cancel</button>
      </div>
    </>}
    {error && <ErrorDetails detail={error} onDismiss={() => setError(null)} />}
  </div>;
}

