"use client";

import { useRef, useState, type MouseEvent } from "react";
import type { ManagedObject } from "@/lib/types/object";
import { estimateProposalSchema, type EstimateProposal } from "@/lib/estimates/model";
import { formatEstimatedDuration, getActionableLeaves, summarizeEstimates } from "@/lib/estimates/time";
import { ApiError, localError, parseErrorDetail } from "@/lib/errors/client";
import type { ErrorDetail } from "@/lib/errors/types";
import { ErrorDetails } from "@/components/ui/ErrorDetails";

export function CardEstimateAction({ object, disabled = false, onApplied, onPendingChange }: { object: ManagedObject; disabled?: boolean; onApplied?: (object: ManagedObject) => void; onPendingChange?: (pending: boolean) => void }) {
  const summary = summarizeEstimates(object.checklist);
  const hasTargets = getActionableLeaves(object.checklist).some((item) => item.estimatedMinutes == null);
  const [proposal, setProposal] = useState<EstimateProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorDetail | null>(null);
  const lock = useRef(false);
  async function analyze(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (lock.current || disabled || !hasTargets || object.archivedAt || object.cancelledAt) return;
    lock.current = true; setBusy(true); setError(null); onPendingChange?.(true);
    try {
      const response = await fetch(`/api/ai/objects/${encodeURIComponent(object.id)}/estimate-time/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "missing" }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new ApiError(parseErrorDetail(data, "Could not estimate time. Please retry."));
      setProposal(estimateProposalSchema.parse(data.proposal));
    } catch (caught) { setError(caught instanceof ApiError ? caught.detail : localError("Could not estimate time. Your Object is unchanged.")); }
    finally { lock.current = false; setBusy(false); onPendingChange?.(false); }
  }
  async function apply(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (lock.current || disabled || !proposal) return;
    lock.current = true; setBusy(true); setError(null); onPendingChange?.(true);
    try {
      const response = await fetch(`/api/ai/objects/${encodeURIComponent(object.id)}/estimate-time/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposal }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new ApiError(parseErrorDetail(data, "Could not apply estimates. Please retry."));
      setProposal(null); onApplied?.(data.object);
    } catch (caught) { setError(caught instanceof ApiError ? caught.detail : localError("Could not apply estimates. The preview is still here.")); }
    finally { lock.current = false; setBusy(false); onPendingChange?.(false); }
  }
  const cancel = (event: MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); if (!busy) { setProposal(null); setError(null); } };
  const previewItems = proposal ? object.checklist.map((item) => { const estimate = proposal.estimates.find((entry) => entry.checklistItemId === item.id); return estimate ? { ...item, estimatedMinutes: estimate.estimatedMinutes } : item; }) : object.checklist;
  const previewSummary = summarizeEstimates(previewItems);
  if (!summary.hasEstimates && (!hasTargets || !onApplied || object.archivedAt || object.cancelledAt)) return null;
  return <div className="mt-2 min-w-0" aria-busy={busy} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    {!proposal ? <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1.5">
      {summary.hasEstimates ? <div className="min-w-0 text-[11px] tabular-nums text-slate-600"><p className="content-wrap">⏱ 总预计 ≈ {formatEstimatedDuration(summary.estimatedTotalMinutes)}</p><p className="content-wrap text-[10px] text-slate-500">Remaining ≈ {formatEstimatedDuration(summary.estimatedRemainingMinutes)}{summary.unestimatedCount ? ` + ${summary.unestimatedCount} unestimated` : ""}</p></div> : <p className="min-w-0 text-[11px] text-slate-500">Estimated Time · 可选</p>}
      {onApplied && hasTargets && !object.archivedAt && !object.cancelledAt && <button type="button" aria-label={`Estimate time: ${object.title}`} className="min-h-11 shrink-0 rounded px-2 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50" disabled={disabled || busy} onClick={analyze}>{busy ? "Estimating…" : "✨ 预计时间"}</button>}
    </div> : <div className="min-w-0 rounded-md border border-indigo-100 bg-indigo-50/70 p-2" aria-label="Card estimate preview" aria-busy={busy}>
      <p className="text-[11px] font-semibold text-indigo-900">AI 预计时间</p>
      <p className="content-wrap mt-0.5 text-xs tabular-nums text-indigo-900">{previewSummary.hasEstimates ? `总预计 ≈ ${formatEstimatedDuration(previewSummary.estimatedTotalMinutes)} · Remaining ≈ ${formatEstimatedDuration(previewSummary.estimatedRemainingMinutes)}` : "暂无有效工作时间估计"}</p>
      {previewSummary.unestimatedCount > 0 && <p className="mt-0.5 text-[10px] text-indigo-700">{previewSummary.unestimatedCount} unestimated</p>}
      {proposal.warning && <p className="mt-1 content-wrap text-[10px] text-amber-800">{proposal.warning}</p>}
      <details className="mt-1 text-[11px] text-slate-600"><summary className="min-h-11 cursor-pointer py-3">查看各步骤预计时间</summary><ul className="space-y-1">{proposal.estimates.map((estimate) => <li className="content-wrap" key={estimate.checklistItemId}>{object.checklist.find((item) => item.id === estimate.checklistItemId)?.title ?? "Checklist item no longer available"} · {estimate.estimatedMinutes === null ? "—" : `≈ ${formatEstimatedDuration(estimate.estimatedMinutes)}`}</li>)}</ul></details>
      <div className="mt-1.5 flex flex-wrap gap-1"><button type="button" className="min-h-11 rounded bg-indigo-600 px-2 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50" disabled={disabled || busy || !proposal.estimates.length} onClick={apply}>{busy ? "Applying…" : "Apply"}</button><button type="button" className="min-h-11 rounded px-2 text-[11px] font-medium text-slate-600 hover:bg-white/80 disabled:opacity-50" disabled={busy} onClick={cancel}>Cancel</button></div>
    </div>}
    {error && <div className="mt-1" onClick={(event) => event.stopPropagation()}><ErrorDetails detail={error} onDismiss={() => setError(null)} /></div>}
  </div>;
}