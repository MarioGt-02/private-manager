"use client";

import { useRef, useState, type PointerEvent } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ObjectCard } from "./ObjectCard";
import type { ColumnDefinition, ManagedObject } from "@/lib/types/object";
import { objectDropId } from "./CancelDropZone";

const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 280;
const MAX_WIDTH = 2400;
function clampWidth(value: number) {
  return Number.isFinite(value) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value))) : DEFAULT_WIDTH;
}
interface ColumnProps {
  column: ColumnDefinition;
  objects: ManagedObject[];
  selectedId?: string | null;
  minimizedIds: Set<string>;
  pendingIds: Set<string>;
  onArchive: () => void;
  onSelect: (id: string) => void;
  onToggleMinimize: (id: string) => void;
  onCompleteNextAction: (objectId: string, itemId: string) => void;
}

function ObjectDropTarget({ object, onSelect, selected, minimized, onToggleMinimize, pending, onCompleteNextAction }: { object: ManagedObject; onSelect: (id: string) => void; selected: boolean; minimized: boolean; onToggleMinimize: () => void; pending: boolean; onCompleteNextAction: (itemId: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({
    id: objectDropId(object.id),
    data: { objectId: object.id, status: object.status },
  });
  return <div ref={setNodeRef} className={`mb-2.5 flow-root break-inside-avoid rounded-lg ${isOver ? "ring-2 ring-blue-400 ring-offset-2" : ""}`}>
    <ObjectCard object={object} onSelect={onSelect} selected={selected} minimized={minimized} onToggleMinimize={onToggleMinimize} pending={pending} onCompleteNextAction={onCompleteNextAction} />
  </div>;
}

export function Column({ column, objects, onSelect, selectedId, onArchive, minimizedIds, pendingIds, onToggleMinimize, onCompleteNextAction }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const storageKey = `private-manager:column-width:${column.id}`;
  const [width, setWidth] = useState(() => {
    try {
      const saved = typeof window === "undefined" ? null : window.localStorage.getItem(storageKey);
      return saved ? clampWidth(Number(saved)) : DEFAULT_WIDTH;
    } catch { return DEFAULT_WIDTH; }
  });
  const currentWidth = useRef(width);
  const drag = useRef<{ pointerId: number; startX: number; width: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  function updateWidth(next: number, save = false) {
    const value = clampWidth(next);
    currentWidth.current = value; setWidth(value);
    if (save) { try { window.localStorage.setItem(storageKey, String(value)); } catch { /* Resizing remains usable without storage. */ } }
  }
  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const original = drag.current.width;
    drag.current = null; setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    updateWidth(cancelled ? original : currentWidth.current, !cancelled);
  }
  return (
    <section
      ref={setNodeRef}
      style={{ width }}
      className={`relative flex min-w-[280px] flex-none flex-col rounded-xl border transition-colors ${
        isOver || resizing ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-100/80"
      }`}
    >
      <header className="flex items-center gap-2 px-4 pb-3 pt-4">
        <span className="text-base leading-none">{column.emoji}</span>
        <h2 className="text-sm font-semibold text-slate-700">{column.label}</h2>
        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-slate-500 ring-1 ring-slate-200">{objects.length}</span>
        <button type="button" className="btn-tertiary" aria-label={`Archived ${column.label} Objects`} title={`Archived — ${column.label}`} onClick={onArchive}>🗂</button>
      </header>
      <div className="min-h-full flex-1 px-2.5 pb-0" style={{ columnWidth: 250, columnGap: 10 }}>
        {objects.map((object) => <ObjectDropTarget key={object.id} object={object} onSelect={onSelect} selected={object.id === selectedId} minimized={minimizedIds.has(object.id)} onToggleMinimize={() => onToggleMinimize(object.id)} pending={pendingIds.has(object.id)} onCompleteNextAction={(itemId) => onCompleteNextAction(object.id, itemId)} />)}
        {!objects.length && <p style={{ columnSpan: "all" }} className="mb-2.5 rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-500">No Objects here yet.</p>}
      </div>
      <div
        role="separator" tabIndex={0} aria-label={`${column.label} 列宽`} aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width}
        title="拖动调整列宽；双击恢复默认。也可用左右方向键调整。"
        className="absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize touch-none items-start justify-center rounded hover:bg-blue-100 focus-visible:bg-blue-100"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          drag.current = { pointerId: event.pointerId, startX: event.clientX, width: currentWidth.current };
          setResizing(true); event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointerId === event.pointerId) updateWidth(drag.current.width + event.clientX - drag.current.startX);
        }}
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
        onLostPointerCapture={(event) => finish(event, true)}
        onDoubleClick={() => updateWidth(DEFAULT_WIDTH, true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault(); updateWidth(width + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 260 : 40), true);
          } else if (event.key === "Home") { event.preventDefault(); updateWidth(DEFAULT_WIDTH, true); }
        }}
      >
        <span aria-hidden="true" className="mt-5 h-5 w-1 rounded-full bg-slate-300" />
      </div>
    </section>
  );
}
