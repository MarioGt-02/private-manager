"use client";

import { useEffect, useRef, useState } from "react";
import { COLUMNS, type ObjectStatus } from "@/lib/types/object";

export function MobileStatusMenu({ objectTitle, currentStatus, onMove }: {
  objectTitle: string;
  currentStatus: ObjectStatus;
  onMove: (status: ObjectStatus) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return <div ref={rootRef} className="relative shrink-0">
    <button
      type="button"
      aria-label={`Move ${objectTitle}`}
      aria-expanded={open}
      title="Move to"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
      className="flex h-10 w-10 items-center justify-center rounded-lg text-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
    >⋮</button>
    {open && <div role="menu" aria-label={`Move ${objectTitle} to`} className="absolute right-0 top-11 z-40 min-w-40 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Move to</p>
      {COLUMNS.map((column) => <button
        key={column.id}
        type="button"
        role="menuitem"
        disabled={column.id === currentStatus}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); setOpen(false); void onMove(column.id); }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-default disabled:text-slate-400"
      >{column.emoji} {column.label}</button>)}
    </div>}
  </div>;
}