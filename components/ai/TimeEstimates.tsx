"use client";
import { useRef, useState } from "react";
import type { ManagedObject } from "@/lib/types/object";
import { formatEstimatedDuration, getActionableLeaves, summarizeEstimates } from "@/lib/estimates/time";
import { estimateProposalSchema, type EstimateProposal, type EstimateMode } from "@/lib/estimates/model";
import { EstimateEditor } from "@/components/checklist/EstimateEditor";
import { ErrorDetails } from "@/components/ui/ErrorDetails";
import { ApiError, localError, parseErrorDetail } from "@/lib/errors/client";
import type { ErrorDetail } from "@/lib/errors/types";

export function EstimateSummary({ items }: { items: ManagedObject["checklist"] }) {
  const summary = summarizeEstimates(items);
  if (!summary.hasEstimates) return null;
  return <div className="space-y-2 text-sm" aria-label="Estimated effort summary">
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">{[["Total", summary.estimatedTotalMinutes], ["Done", summary.estimatedDoneMinutes], ["Remaining", summary.estimatedRemainingMinutes]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="tabular-nums">≈ {formatEstimatedDuration(value as number)}</dd></div>)}</dl>
    {summary.unestimatedCount > 0 && <p className="text-xs text-slate-500">{summary.unestimatedCount} items unestimated — totals cover estimated steps only.</p>}
  </div>;
}
export function TimeEstimates({ object, disabled, onPendingChange, onUpdated }: { object: ManagedObject; disabled: boolean; onPendingChange: (pending: boolean) => void; onUpdated?: (object: ManagedObject) => void }) {
  const [proposal, setProposal] = useState<EstimateProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorDetail | null>(null);
  const lock = useRef(false);
  async function run(mode: EstimateMode, apply = false) {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(null); onPendingChange(true);
    try {
      const response = await fetch(`/api/ai/objects/${encodeURIComponent(object.id)}/estimate-time/${apply ? "apply" : "analyze"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apply ? { proposal } : { mode }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new ApiError(parseErrorDetail(data, "Could not estimate time. Please retry."));
      if (apply) { onUpdated?.(data.object); setProposal(null); } else setProposal(estimateProposalSchema.parse(data.proposal));
    } catch (caught) { setError(caught instanceof ApiError ? caught.detail : localError("Could not save or generate estimates. Your Object is unchanged.")); }
    finally { lock.current = false; setBusy(false); onPendingChange(false); }
  }
  const previewItems = proposal ? object.checklist.map((item) => {
    const proposed = proposal.estimates.find((estimate) => estimate.checklistItemId === item.id);
    return proposed ? { ...item, estimatedMinutes: proposed.estimatedMinutes } : item;
  }) : [];
  return <section aria-label="Estimated Time" className="mt-4 min-w-0 space-y-3 border-t border-slate-200 pt-3" aria-busy={busy}>
    <h3 className="section-label">Estimated Time · optional</h3>
    <EstimateSummary items={object.checklist} />
    {!proposal ? <>
      <p className="text-xs text-slate-500">Approximate active work effort, not waiting or calendar time.</p>
      {!getActionableLeaves(object.checklist).length ? <p className="text-sm text-slate-500">Add checklist items before estimating time.</p> : !object.archivedAt && !object.cancelledAt && <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary min-h-11" disabled={disabled || busy} onClick={() => void run("missing")}>{busy ? "Estimating…" : "✨ Estimate time with AI"}</button>
        <button type="button" className="btn-tertiary min-h-11" disabled={disabled || busy} onClick={() => void run("all")}>Re-estimate all</button>
      </div>}
    </> : <div className="preview-panel min-w-0">
      <h4 className="font-semibold">Review AI time estimates</h4>
      <p className="text-xs text-slate-500">{proposal.mode === "missing" ? "Estimate Missing — existing estimates are preserved." : "Re-estimate All — applying may replace existing estimates."} Review or edit durations before applying.</p>
      <ul className="space-y-2">{proposal.estimates.map((estimate) => <li key={estimate.checklistItemId} className="min-w-0 rounded border border-slate-200 p-2"><p className="content-wrap text-sm">{object.checklist.find((item) => item.id === estimate.checklistItemId)?.title ?? "Checklist item no longer available"}</p><EstimateEditor title={`Proposal ${estimate.checklistItemId}`} value={estimate.estimatedMinutes} disabled={disabled || busy} onSave={async (minutes) => { setProposal((current) => current ? { ...current, estimates: current.estimates.map((entry) => entry.checklistItemId === estimate.checklistItemId ? { ...entry, estimatedMinutes: minutes } : entry) } : null); }} /></li>)}</ul>
      <EstimateSummary items={previewItems} />
      {proposal.warning && <p className="content-wrap text-xs text-amber-800">{proposal.warning}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary min-h-11" disabled={disabled || busy || !proposal.estimates.length} onClick={() => void run(proposal.mode, true)}>Apply estimates</button><button type="button" className="btn-tertiary min-h-11" disabled={busy} onClick={() => { setProposal(null); setError(null); }}>Cancel</button></div>
    </div>}
    {error && <ErrorDetails detail={error} onDismiss={() => setError(null)} />}
  </section>;
}