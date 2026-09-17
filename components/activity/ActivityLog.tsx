"use client";

import { useEffect, useState } from "react";
import { activityLabel, activityResponseSchema, type ActivityUpdate } from "@/lib/activity/types";

type ActivityState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; updates: ActivityUpdate[] };

export function ActivityContent({ state, onRetry }: { state: ActivityState; onRetry: () => void }) {
  if (state.status === "loading") return <p role="status" className="text-sm text-slate-500">Loading activity…</p>;
  if (state.status === "error") return <div role="alert" className="text-sm text-slate-600">
    <p>Could not load activity.</p>
    <button type="button" onClick={onRetry} className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">Retry</button>
  </div>;
  if (!state.updates.length) return <p className="text-sm text-slate-500">No activity yet.</p>;
  return <ol aria-label="Recent activity" className="max-h-96 space-y-3 overflow-y-auto overscroll-contain pr-2">
    {state.updates.map((update) => <li key={update.id} className="min-w-0 border-l-2 border-slate-200 pl-3 text-sm">
      <time dateTime={update.createdAt} className="text-xs text-slate-500">
        {new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(update.createdAt))}
      </time>
      <p className="mt-0.5 font-medium text-slate-700">{update.type === "ai_progress_update" || update.type === "ai_replan" ? "✨ " : ""}{activityLabel(update.type)}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600 [overflow-wrap:anywhere]">{update.content}</p>
    </li>)}
  </ol>;
}

function ActivityRequest({ objectId, onRetry }: { objectId: string; onRetry: () => void }) {
  const [state, setState] = useState<ActivityState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      try {
        const response = await fetch(`/api/objects/${encodeURIComponent(objectId)}/activity`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Activity unavailable");
        const data = activityResponseSchema.parse(await response.json());
        if (data.updates.some((update) => update.objectId !== objectId)) throw new Error("Unexpected Object");
        if (active) setState({ status: "ready", updates: data.updates });
      } catch {
        if (active) setState({ status: "error" });
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [objectId]);
  return <ActivityContent state={state} onRetry={onRetry} />;
}

export function ActivityLog({ objectId, version }: { objectId: string; version: number }) {
  const [attempt, setAttempt] = useState(0);
  return <section aria-label="Activity" className="mt-6 border-t border-slate-200 pt-5">
    <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Activity</h3>
    <ActivityRequest key={`${objectId}:${version}:${attempt}`} objectId={objectId} onRetry={() => setAttempt((value) => value + 1)} />
  </section>;
}
