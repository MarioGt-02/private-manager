"use client";

import type { CSSProperties } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { ManagedObject } from "@/lib/types/object";
import { currentStatePreview } from "@/lib/presentation/category";
import { getFirstActionableIncompleteLeaf } from "@/lib/objects/next-action";
import { colorStyle } from "@/lib/categories/colors";
import { useObjectCategory } from "@/components/categories/CategoryContext";

interface ObjectCardProps {
  object: ManagedObject;
  selected?: boolean;
  minimized: boolean;
  pending: boolean;
  onSelect: (id: string) => void;
  onToggleMinimize: () => void;
  onCompleteNextAction: (itemId: string) => void;
}

export function ObjectCard({ object, onSelect, selected, minimized, pending, onToggleMinimize, onCompleteNextAction }: ObjectCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: object.id });
  const category = useObjectCategory(object);
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), borderLeftColor: colorStyle(category?.color).accent };
  return <article ref={setNodeRef} style={style} {...attributes} {...listeners}
    aria-label={`Open Object: ${object.title}`} role="button" aria-haspopup="dialog"
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(object.id); } }}
    onClick={() => onSelect(object.id)}
    className={`content-wrap cursor-grab select-none rounded-lg border border-l-[5px] border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing ${selected ? "ring-2 ring-blue-500" : ""} ${isDragging ? "opacity-30" : ""}`}>
    <CardBody object={object} minimized={minimized} onToggleMinimize={onToggleMinimize} onCompleteNextAction={onCompleteNextAction} pending={pending} />
  </article>;
}

export function ObjectCardOverlay({ object, minimized = false }: { object: ManagedObject; minimized?: boolean }) {
  const category = useObjectCategory(object);
  return <article aria-hidden="true" className="content-wrap w-[290px] rounded-lg border border-l-[5px] border-slate-300 bg-white p-3 shadow-md" style={{ borderLeftColor: colorStyle(category?.color).accent }}><CardBody object={object} minimized={minimized} /></article>;
}

export function CardBody({ object, minimized = false, onToggleMinimize, onCompleteNextAction, pending = false }: { object: ManagedObject; minimized?: boolean; onToggleMinimize?: () => void; onCompleteNextAction?: (itemId: string) => void; pending?: boolean }) {
  const completed = object.checklist.filter((item) => item.completed).length;
  const total = object.checklist.length;
  const percent = total ? Math.round(completed / total * 100) : 0;
  const category = useObjectCategory(object);
  const palette = colorStyle(category?.color);
  const leaf = getFirstActionableIncompleteLeaf(object.checklist);
  const actionableId = leaf?.id ?? null;
  return <>
    {category && <span title={category.name} className="mb-2 inline-block max-w-full truncate rounded border px-1.5 py-0.5 align-middle text-[10px] font-medium" style={{ backgroundColor: palette.tint, borderColor: palette.accent, color: palette.text }}>{category.name}</span>}
    <div className="flex items-start gap-1">
      <h3 title={object.title} className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-snug tracking-tight text-slate-950">{object.title}</h3>
      {object.unresolvedDependencies > 0 && <span title={`${object.unresolvedDependencies} unresolved ${object.unresolvedDependencies === 1 ? "dependency" : "dependencies"}`} className="shrink-0 self-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-800">🔒 {object.unresolvedDependencies}</span>}
      {onToggleMinimize && <button type="button" onClick={(event) => { event.stopPropagation(); onToggleMinimize(); }} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} aria-label={`${minimized ? "Expand" : "Minimize"} ${object.title}`} aria-expanded={!minimized} title={minimized ? "Expand" : "Minimize"} className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className={`h-4 w-4 transition-transform ${minimized ? "rotate-0" : "rotate-180"}`}><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
      </button>}
    </div>
    {!minimized && <>
      <div className="mt-2.5 rounded-md bg-slate-50 px-2 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Current</p>
        <p className="mt-0.5 line-clamp-3 text-xs leading-5 text-slate-600">{currentStatePreview(object.currentState) || "Not set"}</p>
      </div>
      <div className="mt-2 rounded-md border border-blue-100 bg-blue-50/60 px-2 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-800">Next</p>
        {leaf && actionableId && onCompleteNextAction && object.nextAction === leaf.title ? (
          <div className="mt-0.5 flex items-start gap-1.5">
            <button type="button" onClick={(event) => { event.stopPropagation(); onCompleteNextAction(actionableId); }} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} disabled={pending} aria-label={`Mark "${leaf.title}" complete`} title="Mark current next action complete" className="mt-0.5 shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-40">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><rect x="4" y="4" width="12" height="12" rx="3" /></svg>
            </button>
            <p className="line-clamp-2 min-w-0 flex-1 text-[13px] font-medium leading-5 text-slate-800">{leaf.title}</p>
          </div>
        ) : (
          <p className="mt-0.5 line-clamp-2 text-[13px] font-medium leading-5 text-slate-800"><span aria-hidden="true">→ </span>{object.nextAction || "Not set"}</p>
        )}
      </div>
      {total ? <div className="mt-2.5 flex items-center gap-3">
        <div role="progressbar" aria-label="Checklist completion" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={total} className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
        </div>
        <span className="text-xs font-medium tabular-nums text-slate-600">{completed} / {total}</span>
      </div> : <p className="mt-2 text-[11px] text-slate-400">No checklist</p>}
    </>}
  </>;
}
