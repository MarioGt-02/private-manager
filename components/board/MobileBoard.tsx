"use client";

import { COLUMNS, type ManagedObject, type ObjectStatus } from "@/lib/types/object";
import { ObjectCard } from "./ObjectCard";

export function MobileBoard({ objects, activeStatus, onStatusChange, onSelect, selectedId, minimizedIds, pendingIds, onToggleMinimize, onCompleteNextAction, onMoveStatus }: {
  objects: ManagedObject[];
  activeStatus: ObjectStatus;
  onStatusChange: (status: ObjectStatus) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  minimizedIds: Set<string>;
  pendingIds: Set<string>;
  onToggleMinimize: (id: string) => void;
  onCompleteNextAction: (objectId: string, itemId: string) => void;
  onMoveStatus: (objectId: string, status: ObjectStatus) => Promise<void>;
}) {
  const counts = new Map(COLUMNS.map((column) => [column.id, objects.filter((object) => object.status === column.id).length]));
  const activeColumn = COLUMNS.find((column) => column.id === activeStatus) ?? COLUMNS[0];
  const activeObjects = objects.filter((object) => object.status === activeStatus);

  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 md:hidden" aria-label="Mobile Board">
    <nav aria-label="Board status tabs" className="shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-2">
      <div className="flex min-w-max gap-1">
        {COLUMNS.map((column) => <button key={column.id} type="button" role="tab" aria-selected={activeStatus === column.id} onClick={() => onStatusChange(column.id)} className={`flex min-h-12 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-xs font-semibold ${activeStatus === column.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
          <span aria-hidden="true">{column.emoji}</span>{column.label}<span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums">{counts.get(column.id) ?? 0}</span>
        </button>)}
      </div>
    </nav>
    <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 py-4 pb-6">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{activeColumn.emoji} {activeColumn.label}</h2><span className="text-xs tabular-nums text-slate-500">{activeObjects.length}</span></div>
      <div className="space-y-3">
        {activeObjects.map((object) => <ObjectCard key={object.id} object={object} selected={object.id === selectedId} minimized={minimizedIds.has(object.id)} pending={pendingIds.has(object.id)} onSelect={onSelect} onToggleMinimize={() => onToggleMinimize(object.id)} onCompleteNextAction={(itemId) => onCompleteNextAction(object.id, itemId)} dragEnabled={false} mobile onMoveStatus={(status) => onMoveStatus(object.id, status)} />)}
        {!activeObjects.length && <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">No {activeColumn.label} objects</div>}
      </div>
    </div>
  </section>;
}