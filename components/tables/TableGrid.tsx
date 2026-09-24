"use client";
import { useRef, useState } from "react";
import {
  CARRY_FORWARD_HINTS,
  CURRENCY_CODES,
  COLUMN_TYPE_LABELS,
  TABLE_COLUMN_TYPES,
  cellDisplayValue,
  type ObjectTableView,
  type TableColumnType,
  type TableColumnView,
} from "@/lib/tables/model";

export interface TableGridProps {
  table: ObjectTableView;
  disabled: boolean;
  /** Carry-forward controls are only shown for recurring Objects. */
  recurring: boolean;
  onCells: (cells: { rowId: string; columnId: string; value: string }[]) => void;
  onAddRow: () => void;
  onAddColumn: () => void;
  onDeleteRow: (rowId: string) => void;
  onMoveRow: (rowId: string, direction: -1 | 1) => void;
  onRowCarryForward: (rowId: string, carryForward: boolean) => void;
  onUpdateColumn: (columnId: string, patch: { name?: string; type?: TableColumnType; currency?: string | null; carryForward?: boolean }) => void;
  onMoveColumn: (columnId: string, direction: -1 | 1) => void;
  onDeleteColumn: (columnId: string) => void;
}

/**
 * One editable cell. Commits on blur or Enter and only when the value actually
 * changed, so reading a table never produces a write. Escape restores the
 * stored value. A failed save re-renders the last persisted value.
 */
function EditableCell({ column, value, label, disabled, onCommit }: {
  column: TableColumnView;
  value: string;
  label: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const saving = useRef(false);

  function commit(next: string) {
    if (saving.current || next === value) return;
    saving.current = true;
    try { onCommit(next); } finally { saving.current = false; }
  }

  if (column.type === "checkbox") {
    return <input type="checkbox" aria-label={label} disabled={disabled} checked={value === "true"} onChange={(event) => commit(event.target.checked ? "true" : "false")} />;
  }

  return <input
    aria-label={label}
    type={column.type === "date" ? "date" : "text"}
    inputMode={column.type === "number" || column.type === "currency" ? "decimal" : undefined}
    value={draft}
    disabled={disabled}
    placeholder={column.type === "currency" && column.currency ? column.currency : undefined}
    title={value ? cellDisplayValue(column.type, value, column.currency) : undefined}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => { commit(draft.trim()); setDraft(value); }}
    onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); commit(draft.trim()); }
      else if (event.key === "Escape") { event.preventDefault(); setDraft(value); }
    }}
    className="w-full min-w-[7rem] rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-slate-700 hover:border-slate-200 focus:border-indigo-400 focus:bg-white focus:outline-none"
  />;
}

/** Column header with an always-available, native menu of column operations. */
function ColumnHeader({ column, index, count, disabled, recurring, onUpdate, onMove, onDelete }: {
  column: TableColumnView;
  index: number;
  count: number;
  disabled: boolean;
  recurring: boolean;
  onUpdate: (columnId: string, patch: { name?: string; type?: TableColumnType; currency?: string | null; carryForward?: boolean }) => void;
  onMove: (columnId: string, direction: -1 | 1) => void;
  onDelete: (columnId: string) => void;
}) {
  const [name, setName] = useState(column.name);
  function rename() {
    const next = name.trim();
    if (next && next !== column.name) onUpdate(column.id, { name: next });
  }
  return <th scope="col" className="min-w-[9rem] border-b border-slate-200 px-2 py-1.5 text-left align-bottom">
    <span className="block truncate text-xs font-semibold text-slate-700" title={column.name}>{column.name}</span>
    <span className="mt-0.5 block text-[10px] font-normal uppercase tracking-wide text-slate-400">
      {COLUMN_TYPE_LABELS[column.type]}{column.type === "currency" && column.currency ? ` · ${column.currency}` : ""}
      {recurring && column.carryForward ? " · ↻" : ""}
    </span>
    <details className="mt-1">
      <summary aria-label={`Column options: ${column.name}`} className="cursor-pointer text-[10px] font-medium text-slate-500 hover:text-slate-700">Options</summary>
      <div className="mt-1 w-52 space-y-1.5 rounded-lg border border-slate-200 bg-white p-2 font-normal normal-case">
        <label className="block text-[11px] text-slate-500">Name
          <input aria-label={`Rename ${column.name}`} className="input mt-0.5 px-1.5 py-1 text-xs" value={name} maxLength={60} disabled={disabled}
            onChange={(event) => setName(event.target.value)}
            onBlur={rename}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); rename(); } }} />
        </label>
        <label className="block text-[11px] text-slate-500">Type
          <select aria-label={`Type of ${column.name}`} className="input mt-0.5 px-1.5 py-1 text-xs" value={column.type} disabled={disabled}
            onChange={(event) => { const type = event.target.value as TableColumnType; onUpdate(column.id, { type, ...(type === "currency" ? { currency: column.currency ?? CURRENCY_CODES[0] } : {}) }); }}>
            {TABLE_COLUMN_TYPES.map((type) => <option key={type} value={type}>{COLUMN_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
        {column.type === "currency" && <label className="block text-[11px] text-slate-500">Currency
          <select aria-label={`Currency of ${column.name}`} className="input mt-0.5 px-1.5 py-1 text-xs" value={column.currency ?? ""} disabled={disabled}
            onChange={(event) => onUpdate(column.id, { currency: event.target.value || null })}>
            <option value="">None</option>
            {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>}
        {recurring && <label className="flex items-start gap-1.5 text-[11px] text-slate-600" title={CARRY_FORWARD_HINTS.column}>
          <input type="checkbox" aria-label={CARRY_FORWARD_HINTS.column} checked={column.carryForward} disabled={disabled}
            onChange={(event) => onUpdate(column.id, { carryForward: event.target.checked })} />
          Keep values forward
        </label>}
        <div className="flex items-center gap-1 pt-0.5">
          <button type="button" className="btn-tertiary" aria-label={`Move ${column.name} left`} disabled={disabled || index === 0} onClick={() => onMove(column.id, -1)}>←</button>
          <button type="button" className="btn-tertiary" aria-label={`Move ${column.name} right`} disabled={disabled || index === count - 1} onClick={() => onMove(column.id, 1)}>→</button>
          <button type="button" className="btn-danger ml-auto" aria-label={`Delete column ${column.name}`} disabled={disabled} onClick={() => onDelete(column.id)}>Delete</button>
        </div>
      </div>
    </details>
  </th>;
}

/**
 * Lightweight record grid. Wide tables scroll horizontally instead of being
 * squeezed, so a Drawer can show a 7-column maintenance table and remain usable
 * on a narrow screen.
 */
export function TableGrid({ table, disabled, recurring, onCells, onAddRow, onAddColumn, onDeleteRow, onMoveRow, onRowCarryForward, onUpdateColumn, onMoveColumn, onDeleteColumn }: TableGridProps) {
  const columns = table.columns;
  return <div>
    <div className="overflow-x-auto">
      <table aria-label={table.title} className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((column, index) => <ColumnHeader key={column.id} column={column} index={index} count={columns.length} disabled={disabled} recurring={recurring}
              onUpdate={onUpdateColumn} onMove={onMoveColumn} onDelete={onDeleteColumn} />)}
            <th scope="col" className="w-24 border-b border-slate-200 px-2 py-1.5 text-left">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Row</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => <tr key={row.id} className="align-middle">
            {columns.map((column) => {
              const value = row.cells[column.id] ?? "";
              return <td key={column.id} className="border-b border-slate-100 px-1 py-0.5">
                <EditableCell key={`${column.id}:${value}`} column={column} value={value} disabled={disabled}
                  label={`${column.name} · row ${rowIndex + 1}`} onCommit={(next) => onCells([{ rowId: row.id, columnId: column.id, value: next }])} />
              </td>;
            })}
            <td className="border-b border-slate-100 px-1 py-0.5">
              <div className="flex items-center gap-0.5">
                {recurring && <label className="px-0.5 text-slate-500" title={CARRY_FORWARD_HINTS.row}>
                  <input type="checkbox" aria-label={`${CARRY_FORWARD_HINTS.row}: row ${rowIndex + 1}`} checked={row.carryForward} disabled={disabled}
                    onChange={(event) => onRowCarryForward(row.id, event.target.checked)} />
                </label>}
                <button type="button" aria-label={`Move row ${rowIndex + 1} up`} disabled={disabled || rowIndex === 0} onClick={() => onMoveRow(row.id, -1)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30">↑</button>
                <button type="button" aria-label={`Move row ${rowIndex + 1} down`} disabled={disabled || rowIndex === table.rows.length - 1} onClick={() => onMoveRow(row.id, 1)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30">↓</button>
                <button type="button" aria-label={`Delete row ${rowIndex + 1}`} disabled={disabled} onClick={() => onDeleteRow(row.id)} className="rounded p-0.5 text-slate-400 hover:text-red-600 disabled:opacity-30">×</button>
              </div>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {!columns.length && <p className="empty-note mt-2">Add a column to start recording.</p>}
    {columns.length > 0 && !table.rows.length && <p className="empty-note mt-2">No rows yet.</p>}
    <div className="mt-2 flex flex-wrap items-center gap-1">
      <button type="button" className="btn-tertiary" disabled={disabled || !columns.length} onClick={onAddRow}>+ Add row</button>
      <button type="button" className="btn-tertiary" disabled={disabled} onClick={onAddColumn}>+ Add column</button>
    </div>
  </div>;
}
