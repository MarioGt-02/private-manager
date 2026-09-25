"use client";
import { useState } from "react";
import { addColumn, changeColumnType, deleteColumn, moveColumn } from "@/lib/ai/draft-table";
import { CARRY_FORWARD_HINTS, COLUMN_TYPE_LABELS, CURRENCY_CODES, TABLE_COLUMN_TYPES, TABLE_LIMITS, type TableColumnType } from "@/lib/tables/model";
import type { DraftTable } from "@/lib/ai/types";

interface DraftTableEditorProps {
  table: DraftTable;
  recurring: boolean;
  disabled: boolean;
  onChange: (table: DraftTable) => void;
  onRemove: () => void;
}

const cellInput = "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-slate-700 hover:border-slate-200 focus:border-indigo-400 focus:bg-white focus:outline-none";
const columnNameInput = "min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-400";

function withRow(table: DraftTable, index: number, patch: Partial<DraftTable["rows"][number]>): DraftTable {
  return { ...table, rows: table.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) };
}

function withColumn(table: DraftTable, index: number, patch: Partial<DraftTable["columns"][number]>): DraftTable {
  return { ...table, columns: table.columns.map((column, i) => (i === index ? { ...column, ...patch } : column)) };
}

/**
 * Local-state structured table editor for the AI draft. Column/cell alignment
 * is maintained exclusively through lib/ai/draft-table helpers, and cell values
 * reuse the same column types and limits as the rest of Object Tables.
 */
export function DraftTableEditor({ table, recurring, disabled, onChange, onRemove }: DraftTableEditorProps) {
  const [error, setError] = useState("");

  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    onChange({
      ...table,
      rows: table.rows.map((row, ri) => ri === rowIndex
        ? { ...row, cells: row.cells.map((cell, ci) => (ci === columnIndex ? value : cell)) }
        : row),
    });
  }

  function changeType(index: number, nextType: TableColumnType) {
    const result = changeColumnType(table, index, nextType, table.columns[index]?.currency ?? null);
    if (result.ok) { setError(""); onChange(result.table); }
    else setError(result.message);
  }

  function addRow() {
    onChange({ ...table, rows: [...table.rows, { carryForward: false, cells: table.columns.map(() => "") }] });
  }

  function addColumnNew() {
    onChange(addColumn(table, { name: `Column ${table.columns.length + 1}`, type: "text", currency: null, carryForward: false }));
  }

  return <div>
    <div className="mb-1 flex flex-wrap items-center gap-2">
      <input aria-label="Draft table title" className={columnNameInput} maxLength={TABLE_LIMITS.tableTitle} value={table.title}
        disabled={disabled} placeholder="Table title"
        onChange={(event) => onChange({ ...table, title: event.target.value })} />
      <span className="text-xs tabular-nums text-slate-400">{table.rows.length} {table.rows.length === 1 ? "row" : "rows"}</span>
      <button type="button" className="btn-danger ml-auto" disabled={disabled} onClick={onRemove}>Remove table</button>
    </div>

    {error && <p role="alert" className="error-note mb-1">{error}</p>}

    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {table.columns.map((column, index) => <th key={index} scope="col" className="min-w-[8rem] border-b border-slate-200 px-1.5 py-1 align-bottom">
              <input aria-label={`Draft column ${index + 1} name`} className={columnNameInput} maxLength={TABLE_LIMITS.columnName} value={column.name} disabled={disabled}
                onChange={(event) => onChange(withColumn(table, index, { name: event.target.value }))} />
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <select aria-label={`Draft column ${index + 1} type`} className="input px-1.5 py-0.5 text-xs" value={column.type} disabled={disabled}
                  onChange={(event) => changeType(index, event.target.value as TableColumnType)}>
                  {TABLE_COLUMN_TYPES.map((type) => <option key={type} value={type}>{COLUMN_TYPE_LABELS[type]}</option>)}
                </select>
                {column.type === "currency" && <select aria-label={`Draft column ${index + 1} currency`} className="input w-20 px-1.5 py-0.5 text-xs" value={column.currency ?? ""} disabled={disabled}
                  onChange={(event) => onChange(withColumn(table, index, { currency: event.target.value || null }))}>
                  <option value="">None</option>
                  {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
                </select>}
                {recurring && <label className="flex items-center gap-1 text-[11px] text-slate-600" title={CARRY_FORWARD_HINTS.column}>
                  <input type="checkbox" aria-label={CARRY_FORWARD_HINTS.column} checked={column.carryForward} disabled={disabled}
                    onChange={(event) => onChange(withColumn(table, index, { carryForward: event.target.checked }))} />
                </label>}
              </div>
              <div className="mt-1 flex items-center gap-0.5">
                <button type="button" aria-label={`Move draft column ${index + 1} left`} disabled={disabled || index === 0} onClick={() => onChange(moveColumn(table, index, index - 1))} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30">←</button>
                <button type="button" aria-label={`Move draft column ${index + 1} right`} disabled={disabled || index === table.columns.length - 1} onClick={() => onChange(moveColumn(table, index, index + 1))} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30">→</button>
                <button type="button" aria-label={`Delete draft column ${index + 1}`} disabled={disabled} onClick={() => onChange(deleteColumn(table, index))} className="rounded p-0.5 text-slate-400 hover:text-red-600 disabled:opacity-30">×</button>
              </div>
            </th>)}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => <tr key={rowIndex} className="align-middle">
            {table.columns.map((column, columnIndex) => <td key={columnIndex} className={column.type === "checkbox" ? "border-b border-slate-100 px-1.5 py-0.5 text-center" : "border-b border-slate-100 px-1.5 py-0.5"}>
              {column.type === "checkbox"
                ? <input type="checkbox" aria-label={`Draft cell row ${rowIndex + 1} ${column.name}`} checked={row.cells[columnIndex] === "true"} disabled={disabled}
                    onChange={(event) => updateCell(rowIndex, columnIndex, event.target.checked ? "true" : "false")} />
                : <input aria-label={`Draft cell row ${rowIndex + 1} ${column.name}`} type={column.type === "date" ? "date" : "text"}
                    inputMode={column.type === "number" || column.type === "currency" ? "decimal" : undefined}
                    value={row.cells[columnIndex] ?? ""} disabled={disabled}
                    placeholder={column.type === "currency" && column.currency ? column.currency : undefined}
                    onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)} className={cellInput} />}
            </td>)}
            <td className="border-b border-slate-100 px-1 py-0.5">
              <div className="flex items-center gap-0.5">
                {recurring && <button type="button" role="switch" aria-checked={row.carryForward} aria-label={`${CARRY_FORWARD_HINTS.row}: row ${rowIndex + 1}`} title={CARRY_FORWARD_HINTS.row} disabled={disabled}
                  onClick={() => onChange(withRow(table, rowIndex, { carryForward: !row.carryForward }))}
                  className={`rounded p-0.5 text-sm leading-none disabled:opacity-30 ${row.carryForward ? "text-blue-600 hover:bg-blue-50" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"}`}>↻</button>}
                <button type="button" aria-label={`Move draft row ${rowIndex + 1} up`} disabled={disabled || rowIndex === 0}
                  onClick={() => { const rows = [...table.rows]; [rows[rowIndex - 1], rows[rowIndex]] = [rows[rowIndex], rows[rowIndex - 1]]; onChange({ ...table, rows }); }} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30">↑</button>
                <button type="button" aria-label={`Move draft row ${rowIndex + 1} down`} disabled={disabled || rowIndex === table.rows.length - 1}
                  onClick={() => { const rows = [...table.rows]; [rows[rowIndex + 1], rows[rowIndex]] = [rows[rowIndex], rows[rowIndex + 1]]; onChange({ ...table, rows }); }} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30">↓</button>
                <button type="button" aria-label={`Delete draft row ${rowIndex + 1}`} disabled={disabled} onClick={() => onChange({ ...table, rows: table.rows.filter((_, i) => i !== rowIndex) })} className="rounded p-0.5 text-slate-400 hover:text-red-600 disabled:opacity-30">×</button>
              </div>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {!table.columns.length && <p className="empty-note mt-2">Add a column to start recording.</p>}
    <div className="mt-2 flex flex-wrap items-center gap-1">
      <button type="button" className="btn-tertiary" disabled={disabled || !table.columns.length} onClick={addRow}>+ Add row</button>
      <button type="button" className="btn-tertiary" disabled={disabled || table.columns.length >= TABLE_LIMITS.columnsPerTable} onClick={addColumnNew}>+ Add column</button>
    </div>
  </div>;
}
