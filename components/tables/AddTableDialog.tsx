"use client";
import { useState } from "react";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";
import {
  CARRY_FORWARD_HINTS,
  CURRENCY_CODES,
  COLUMN_TYPE_LABELS,
  TABLE_COLUMN_TYPES,
  TABLE_LIMITS,
  type TableColumnType,
} from "@/lib/tables/model";

interface StarterColumn {
  name: string;
  type: TableColumnType;
  currency: string;
  carryForward: boolean;
}

export interface CreateTableInput {
  title: string;
  columns: { name: string; type: TableColumnType; currency?: string | null; carryForward?: boolean }[];
}

/**
 * Minimal creation dialog: a title and the starting columns. No wizard, no
 * configuration step beyond what a table needs to be usable.
 */
export function AddTableDialog({ recurring, busy, onClose, onCreate }: {
  recurring: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: CreateTableInput) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [columns, setColumns] = useState<StarterColumn[]>([{ name: "Item", type: "text", currency: CURRENCY_CODES[0], carryForward: false }]);
  const [error, setError] = useState("");

  function patch(index: number, change: Partial<StarterColumn>) {
    setColumns((current) => current.map((column, position) => (position === index ? { ...column, ...change } : column)));
  }

  const ready = title.trim().length > 0 && columns.length > 0 && columns.every((column) => column.name.trim().length > 0);

  async function submit() {
    if (!ready || busy) return;
    setError("");
    try {
      await onCreate({
        title: title.trim(),
        columns: columns.map((column) => ({
          name: column.name.trim(),
          type: column.type,
          currency: column.type === "currency" ? column.currency : null,
          carryForward: column.carryForward,
        })),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the table.");
    }
  }

  return <WorkspaceDialog compact label="Add table" busy={busy} onClose={onClose}>
    <div className="space-y-3 p-5 sm:p-6">
      <h2 className="text-base font-semibold">Add a table</h2>
      <p className="text-sm leading-6 text-slate-600">Tables hold structured details that belong to this Object, such as parts, costs or test results. Checklist steps stay in the Checklist.</p>
      <label className="block text-sm">Table title
        <input autoFocus className="input mt-1" value={title} maxLength={TABLE_LIMITS.tableTitle} disabled={busy}
          placeholder="Maintenance items" onChange={(event) => setTitle(event.target.value)} />
      </label>
      <fieldset disabled={busy} className="space-y-2">
        <legend className="section-label">Columns</legend>
        {columns.map((column, index) => <div key={index} className="flex flex-wrap items-center gap-1.5">
          <input aria-label={`Column ${index + 1} name`} className="input flex-1" value={column.name} maxLength={TABLE_LIMITS.columnName}
            onChange={(event) => patch(index, { name: event.target.value })} />
          <select aria-label={`Column ${index + 1} type`} className="input w-32" value={column.type} onChange={(event) => patch(index, { type: event.target.value as TableColumnType })}>
            {TABLE_COLUMN_TYPES.map((type) => <option key={type} value={type}>{COLUMN_TYPE_LABELS[type]}</option>)}
          </select>
          {column.type === "currency" && <select aria-label={`Column ${index + 1} currency`} className="input w-24" value={column.currency} onChange={(event) => patch(index, { currency: event.target.value })}>
            {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>}
          {recurring && <label className="flex items-center gap-1 text-xs text-slate-600" title={CARRY_FORWARD_HINTS.column}>
            <input type="checkbox" checked={column.carryForward} onChange={(event) => patch(index, { carryForward: event.target.checked })} />
            Keep values
          </label>}
          <button type="button" className="btn-danger" aria-label={`Remove column ${index + 1}`} disabled={columns.length === 1}
            onClick={() => setColumns((current) => current.filter((_, position) => position !== index))}>×</button>
        </div>)}
        <button type="button" className="btn-tertiary" disabled={columns.length >= TABLE_LIMITS.columnsPerTable}
          onClick={() => setColumns((current) => [...current, { name: `Column ${current.length + 1}`, type: "text", currency: CURRENCY_CODES[0], carryForward: false }])}>+ Add column</button>
      </fieldset>
      {error && <p role="alert" className="error-note">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={busy || !ready} onClick={() => void submit()}>{busy ? "Creating…" : "Create table"}</button>
      </div>
    </div>
  </WorkspaceDialog>;
}
