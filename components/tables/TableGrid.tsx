"use client";
import { useRef, useState } from "react";
import {
  CARRY_FORWARD_HINTS,
  COLUMN_WIDTH_CLASSES,
  ROW_ACTIONS_WIDTH_CLASS,
  cellDisplayValue,
  type ObjectTableView,
  type TableColumnType,
  type TableColumnView,
} from "@/lib/tables/model";
import { ColumnMenu, type ColumnMenuProps } from "./ColumnMenu";

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
    className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-slate-700 hover:border-slate-200 focus:border-indigo-400 focus:bg-white focus:outline-none"
  />;
}

/** Column header: the name, an optional repeat marker and the column menu. */
function ColumnHeader(props: ColumnMenuProps) {
  const { column, recurring } = props;
  return <th scope="col" className={`${COLUMN_WIDTH_CLASSES[column.type]} border-b border-slate-200 px-2 py-1.5 text-left align-bottom`}>
    <div className="flex items-start justify-between gap-1">
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <span className="truncate text-xs font-semibold text-slate-700" title={column.name}>{column.name}</span>
        {recurring && column.carryForward && <span aria-hidden="true" title={CARRY_FORWARD_HINTS.column} className="shrink-0 text-[10px] leading-none text-blue-600">↻</span>}
      </span>
      <ColumnMenu {...props} />
    </div>
  </th>;
}


/**
 * Lightweight record grid. Wide tables scroll horizontally inside their own
 * viewport instead of being squeezed, so the Object workspace can show a
 * 7-column maintenance table and remain usable.
 */
export function TableGrid({ table, disabled, recurring, onCells, onAddRow, onAddColumn, onDeleteRow, onMoveRow, onRowCarryForward, onUpdateColumn, onMoveColumn, onDeleteColumn }: TableGridProps) {
  const columns = table.columns;
  return <div>
    <div className="overflow-x-auto">
      <table aria-label={table.title} className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((column, index) => <ColumnHeader key={column.id} column={column} index={index} count={columns.length} disabled={disabled} recurring={recurring}
              onUpdate={onUpdateColumn} onMove={onMoveColumn} onDelete={onDeleteColumn} />)}
            <th scope="col" className={`${ROW_ACTIONS_WIDTH_CLASS} border-b border-slate-200 px-2 py-1.5 text-left`}>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Row</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => <tr key={row.id} className="align-middle">
            {columns.map((column) => {
              const value = row.cells[column.id] ?? "";
              return <td key={column.id} className={column.type === "checkbox" ? "border-b border-slate-100 px-1 py-0.5 text-center" : "border-b border-slate-100 px-1 py-0.5"}>
                <EditableCell key={`${column.id}:${value}`} column={column} value={value} disabled={disabled}
                  label={`${column.name} · row ${rowIndex + 1}`} onCommit={(next) => onCells([{ rowId: row.id, columnId: column.id, value: next }])} />
              </td>;
            })}
            <td className="border-b border-slate-100 px-1 py-0.5">
              <div className="flex items-center gap-0.5">
                {recurring && <button type="button" role="switch" aria-checked={row.carryForward}
                  aria-label={`${CARRY_FORWARD_HINTS.row}: row ${rowIndex + 1}`} title={CARRY_FORWARD_HINTS.row} disabled={disabled}
                  onClick={() => onRowCarryForward(row.id, !row.carryForward)}
                  className={`rounded p-0.5 text-sm leading-none disabled:opacity-30 ${row.carryForward ? "text-blue-600 hover:bg-blue-50" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"}`}>↻</button>}
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
