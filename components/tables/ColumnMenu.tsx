"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  CARRY_FORWARD_HINTS,
  CURRENCY_CODES,
  COLUMN_TYPE_LABELS,
  TABLE_COLUMN_TYPES,
  type TableColumnType,
  type TableColumnView,
} from "@/lib/tables/model";

export interface ColumnMenuProps {
  column: TableColumnView;
  index: number;
  count: number;
  disabled: boolean;
  /** Carry-forward controls are only rendered for recurring Objects. */
  recurring: boolean;
  onUpdate: (columnId: string, patch: { name?: string; type?: TableColumnType; currency?: string | null; carryForward?: boolean }) => void;
  onMove: (columnId: string, direction: -1 | 1) => void;
  onDelete: (columnId: string) => void;
}

const MENU_WIDTH = 240;

const itemClass = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-100";

/**
 * The column menu panel.
 *
 * It is positioned with `position: fixed`, which has two deliberate effects:
 * the table's `overflow-x-auto` viewport cannot clip it, and it never takes
 * part in table layout, so opening it cannot push table content down. Fixed
 * positioning resolves against the viewport because the workspace dialog
 * defines no transform/filter/contain (see app/globals.css).
 *
 * Exported so tests can assert the available operations directly.
 */
export function ColumnMenuPanel({
  column, index, count, disabled, recurring, onUpdate, onMove, onDelete, onClose, style, panelRef,
}: ColumnMenuProps & { onClose: () => void; style?: CSSProperties; panelRef?: RefObject<HTMLDivElement | null> }) {
  const [mode, setMode] = useState<"menu" | "rename" | "confirm">("menu");
  const [draft, setDraft] = useState(column.name);

  function rename() {
    const next = draft.trim();
    if (next && next !== column.name) onUpdate(column.id, { name: next });
    setMode("menu");
  }

  return <div ref={panelRef} data-popover="true" role="dialog" aria-label={`Column options: ${column.name}`} tabIndex={-1} style={style}
    className="fixed z-50 max-h-[70vh] w-60 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 text-left text-xs font-normal normal-case tracking-normal shadow-lg">
    {mode === "confirm" ? <>
      <p className="content-wrap px-1 text-slate-700">Delete “{column.name}” and all of its values?</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className="btn-danger border border-red-200" aria-label={`Confirm delete column ${column.name}`} disabled={disabled}
          onClick={() => { onDelete(column.id); onClose(); }}>Delete column</button>
        <button type="button" className="btn-secondary" onClick={() => setMode("menu")}>Cancel</button>
      </div>
    </> : mode === "rename" ? <form className="space-y-1.5" onSubmit={(event) => { event.preventDefault(); rename(); }}>
      <label className="block px-1 text-[11px] text-slate-500">Name
        <input autoFocus className="input mt-0.5 px-1.5 py-1 text-xs" value={draft} maxLength={60} disabled={disabled}
          aria-label={`Rename ${column.name}`} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <div className="flex gap-1.5">
        <button type="submit" className="btn-primary" disabled={disabled || !draft.trim()}>Save</button>
        <button type="button" className="btn-secondary" onClick={() => { setDraft(column.name); setMode("menu"); }}>Cancel</button>
      </div>
    </form> : <>
      <button type="button" className={itemClass} aria-label={`Rename ${column.name}`} onClick={() => { setDraft(column.name); setMode("rename"); }}>Rename</button>
      <label className="flex items-center justify-between gap-2 rounded px-2 py-1 text-[11px] text-slate-500">Type
        <select aria-label={`Type of ${column.name}`} className="input w-28 px-1.5 py-1 text-xs" value={column.type} disabled={disabled}
          onChange={(event) => {
            const type = event.target.value as TableColumnType;
            onUpdate(column.id, { type, ...(type === "currency" ? { currency: column.currency ?? CURRENCY_CODES[0] } : {}) });
          }}>
          {TABLE_COLUMN_TYPES.map((type) => <option key={type} value={type}>{COLUMN_TYPE_LABELS[type]}</option>)}
        </select>
      </label>
      {column.type === "currency" && <label className="flex items-center justify-between gap-2 rounded px-2 py-1 text-[11px] text-slate-500">Currency
        <select aria-label={`Currency of ${column.name}`} className="input w-28 px-1.5 py-1 text-xs" value={column.currency ?? ""} disabled={disabled}
          onChange={(event) => onUpdate(column.id, { currency: event.target.value || null })}>
          <option value="">None</option>
          {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>}
      {recurring && <label className="flex items-start gap-1.5 rounded px-2 py-1 text-[11px] text-slate-600" title={CARRY_FORWARD_HINTS.column}>
        <input type="checkbox" className="mt-0.5" aria-label={CARRY_FORWARD_HINTS.column} checked={column.carryForward} disabled={disabled}
          onChange={(event) => onUpdate(column.id, { carryForward: event.target.checked })} />
        Keep values forward
      </label>}
      <div className="my-1 border-t border-slate-200" />
      <button type="button" className={itemClass} aria-label={`Move ${column.name} left`} disabled={disabled || index === 0} onClick={() => onMove(column.id, -1)}>
        <span aria-hidden="true">←</span> Move left
      </button>
      <button type="button" className={itemClass} aria-label={`Move ${column.name} right`} disabled={disabled || index === count - 1} onClick={() => onMove(column.id, 1)}>
        <span aria-hidden="true">→</span> Move right
      </button>
      <div className="my-1 border-t border-slate-200" />
      <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
        aria-label={`Delete column ${column.name}`} disabled={disabled} onClick={() => setMode("confirm")}>Delete column</button>
    </>}
  </div>;
}

/**
 * Compact column menu trigger (⋮).
 *
 * The panel is measured from the trigger on click and rendered with
 * `position: fixed`, so opening the menu never changes table layout and is
 * never clipped by the table's horizontal scroll viewport.
 */
export function ColumnMenu(props: ColumnMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    // Right-align with the trigger, clamped inside the viewport.
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPosition({ top: rect.bottom + 4, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    function dismiss(refocus: boolean) {
      setOpen(false);
      if (refocus) trigger.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      dismiss(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Consume Escape so only the menu closes, not the workspace dialog.
      event.preventDefault();
      event.stopPropagation();
      dismiss(true);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    // Keep the panel attached to its trigger while the table or page scrolls.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  function toggle() {
    if (open) { setOpen(false); return; }
    place();
    setOpen(true);
  }

  return <span className="relative inline-flex">
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Column options: ${props.column.name}`} title={`Column options: ${props.column.name}`}
      onClick={toggle} className="rounded px-1 text-sm leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">⋮</button>
    {open && position && <ColumnMenuPanel {...props} style={position} panelRef={panel} onClose={() => setOpen(false)} />}
  </span>;
}
