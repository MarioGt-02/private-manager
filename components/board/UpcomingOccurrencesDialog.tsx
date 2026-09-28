"use client";

import { useObjectCategory } from "@/components/categories/CategoryContext";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";
import { colorStyle } from "@/lib/categories/colors";
import type { UpcomingOccurrenceSummary } from "@/lib/db/queries";

function UpcomingRow({ occurrence }: { occurrence: UpcomingOccurrenceSummary }) {
  const category = useObjectCategory({ categoryId: occurrence.categoryId });
  return <li className="border-b border-slate-100 py-3">
    <div className="flex min-w-0 items-start gap-3 border-l-[3px] pl-3" style={{ borderColor: colorStyle(category?.color).accent }}>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-800">{occurrence.title}</span>
        {category && <span className="mt-1 block text-xs text-slate-500">{category.name}</span>}
      </span>
      <time dateTime={occurrence.nextDate} className="shrink-0 text-xs tabular-nums text-slate-500">{occurrence.nextDate}</time>
    </div>
  </li>;
}

export function UpcomingOccurrencesDialog({ occurrences, loading, error, onClose }: {
  occurrences: UpcomingOccurrenceSummary[] | null;
  loading: boolean;
  error: boolean;
  onClose: () => void;
}) {
  return <WorkspaceDialog label="Upcoming occurrences" onClose={onClose}>
    <header className="flex items-center justify-between gap-3 border-b border-slate-200 p-5">
      <h2 className="text-base font-semibold">Upcoming occurrences</h2>
      <button type="button" autoFocus className="btn-secondary" onClick={onClose}>Close</button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      {loading && <p role="status" className="text-sm text-slate-500">Loading…</p>}
      {error && <p role="alert" className="error-note">Could not load upcoming occurrences.</p>}
      {occurrences && <>
        <p className="mb-2 text-xs text-slate-500">{occurrences.length} upcoming</p>
        {!occurrences.length && <p className="empty-note">No upcoming occurrences.</p>}
        <ul>{occurrences.map((occurrence) => <UpcomingRow key={occurrence.id} occurrence={occurrence} />)}</ul>
      </>}
    </div>
  </WorkspaceDialog>;
}