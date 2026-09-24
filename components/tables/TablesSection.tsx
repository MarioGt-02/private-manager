"use client";
import { useEffect, useRef, useState } from "react";
import { AddTableDialog, type CreateTableInput } from "./AddTableDialog";
import { TableGrid } from "./TableGrid";
import { TABLE_LIMITS, type ObjectTableView, type TableColumnType } from "@/lib/tables/model";

interface TablesSectionProps {
  objectId: string;
  /** Carry-forward controls are only rendered for recurring Objects. */
  recurring: boolean;
  disabled: boolean;
  /** Refresh the Drawer Activity list after a structural change. */
  onActivityChange: () => void;
}

type ColumnPatch = { name?: string; type?: TableColumnType; currency?: string | null; carryForward?: boolean };

function message(caught: unknown, fallback: string) {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/** Apply cell values locally so typing feels immediate before the server confirms. */
function withCells(table: ObjectTableView, cells: { rowId: string; columnId: string; value: string }[]): ObjectTableView {
  const next = new Map<string, Record<string, string>>();
  for (const cell of cells) {
    let values = next.get(cell.rowId);
    if (!values) {
      const row = table.rows.find((item) => item.id === cell.rowId);
      if (!row) continue;
      values = { ...row.cells };
    }
    if (cell.value === "") delete values[cell.columnId];
    else values[cell.columnId] = cell.value;
    next.set(cell.rowId, values);
  }
  return { ...table, rows: table.rows.map((row) => next.has(row.id) ? { ...row, cells: next.get(row.id)! } : row) };
}

/**
 * Object Tables inside the Drawer. Records load only when the Drawer needs
 * them, so the Board never fetches every table and cell up front.
 */
export function TablesSection({ objectId, recurring, disabled, onActivityChange }: TablesSectionProps) {
  const [tables, setTables] = useState<ObjectTableView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renameDraft, setRenameDraft] = useState<{ tableId: string; title: string } | null>(null);
  const lock = useRef(false);
  const latest = useRef<ObjectTableView[] | null>(null);

  // Synced in an effect so handlers always read the latest server-confirmed rows.
  useEffect(() => { latest.current = tables; }, [tables]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch(`/api/objects/${encodeURIComponent(objectId)}/tables`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (active) { setTables(data.tables); setError(""); }
      })
      .catch(() => {
        if (active) setError("Could not load tables.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; controller.abort(); };
  }, [objectId]);

  function replaceTable(next: ObjectTableView) {
    setTables((current) => current ? current.map((table) => (table.id === next.id ? next : table)) : current);
  }

  async function sendTable(tableId: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/objects/${encodeURIComponent(objectId)}/tables/${encodeURIComponent(tableId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message ?? "Could not save the table change.");
    return data.table as ObjectTableView;
  }

  /** Structural changes are serialised; cell writes are independent and batched. */
  async function structural(run: () => Promise<void>, logsActivity = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await run();
      if (logsActivity) onActivityChange();
    } catch (caught) {
      setError(message(caught, "Could not save the table change."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function writeCells(tableId: string, cells: { rowId: string; columnId: string; value: string }[]) {
    const table = latest.current?.find((item) => item.id === tableId);
    if (!table) return;
    const previous = cells.map((cell) => ({
      rowId: cell.rowId,
      columnId: cell.columnId,
      value: table.rows.find((row) => row.id === cell.rowId)?.cells[cell.columnId] ?? "",
    }));
    replaceTable(withCells(table, cells));
    setError("");
    try {
      const response = await fetch(`/api/objects/${encodeURIComponent(objectId)}/tables/${encodeURIComponent(tableId)}/cells`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not save that value.");
      replaceTable(data.table as ObjectTableView);
    } catch (caught) {
      // Restore exactly the values this write touched; other edits are untouched.
      setTables((current) => current ? current.map((item) => (item.id === tableId ? withCells(item, previous) : item)) : current);
      setError(message(caught, "Could not save that value."));
    }
  }

  function toggleCollapsed(tableId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(tableId)) next.delete(tableId);
      else next.add(tableId);
      return next;
    });
  }

  const mutate = (table: ObjectTableView, body: Record<string, unknown>) =>
    structural(async () => replaceTable(await sendTable(table.id, { ...body, tableId: table.id })));

  async function deleteTable(tableId: string) {
    await structural(async () => {
      const response = await fetch(`/api/objects/${encodeURIComponent(objectId)}/tables/${encodeURIComponent(tableId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not delete the table.");
      setTables(data.tables as ObjectTableView[]);
      setConfirmDelete(null);
    }, true);
  }

  async function createTable(input: CreateTableInput) {
    await structural(async () => {
      const response = await fetch(`/api/objects/${encodeURIComponent(objectId)}/tables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not create the table.");
      setTables((current) => [...(current ?? []), data.table as ObjectTableView]);
      setAdding(false);
    }, true);
  }

  function updateColumn(table: ObjectTableView, columnId: string, patch: ColumnPatch) {
    void mutate(table, { action: "update_column", columnId, ...patch });
  }

  return <section aria-label="Tables" className="mt-4 border-t border-slate-200 pt-3">
    <div className="mb-1 flex items-center justify-between gap-2">
      <h3 className="section-label">Tables / Records</h3>
      {!adding && (tables?.length ?? 0) < TABLE_LIMITS.tablesPerObject && (
        <button type="button" className="btn-tertiary" disabled={disabled || loading || busy} onClick={() => setAdding(true)}>+ Add table</button>
      )}
    </div>

    {loading && <p role="status" className="text-xs text-slate-500">Loading tables…</p>}
    {error && <p role="alert" className="error-note">{error}</p>}

    {tables && !tables.length && !loading && !adding && (
      <p className="py-1 text-sm text-slate-400">No tables yet. Use one to record structured details such as parts, costs or test results.</p>
    )}

    {tables?.map((table) => {
      const open = !collapsed.has(table.id);
      return <article key={table.id} className="mt-2 rounded-lg border border-slate-200 p-2">
        <header className="flex flex-wrap items-center gap-1">
          {renameDraft?.tableId === table.id ? <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(event) => {
            event.preventDefault();
            const next = renameDraft.title.trim();
            setRenameDraft(null);
            if (next && next !== table.title) void mutate(table, { action: "rename_table", title: next });
          }}>
            <input autoFocus className="input" aria-label={`New title for ${table.title}`} value={renameDraft.title} maxLength={TABLE_LIMITS.tableTitle}
              disabled={busy || disabled} onChange={(event) => setRenameDraft({ tableId: table.id, title: event.target.value })} />
            <button type="submit" className="btn-primary" disabled={busy || disabled || !renameDraft.title.trim()}>Save</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setRenameDraft(null)}>Cancel</button>
          </form> : <>
            <button type="button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} table ${table.title}`} onClick={() => toggleCollapsed(table.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              <span aria-hidden="true" className="text-slate-400">{open ? "▾" : "▸"}</span>
              <span className="truncate text-sm font-medium text-slate-700" title={table.title}>{table.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-slate-400">{table.rows.length} {table.rows.length === 1 ? "row" : "rows"}</span>
            </button>
            <button type="button" className="btn-tertiary" aria-label={`Rename table ${table.title}`} disabled={disabled || busy}
              onClick={() => setRenameDraft({ tableId: table.id, title: table.title })}>Rename</button>
            <button type="button" className="btn-danger" aria-label={`Delete table ${table.title}`} disabled={disabled || busy} onClick={() => setConfirmDelete(table.id)}>Delete</button>
          </>}
        </header>

        {confirmDelete === table.id && <div className="mt-2 space-y-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm">
          <p className="content-wrap">Delete “{table.title}” and all of its rows and values? This cannot be undone.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-danger border border-red-200" disabled={busy} onClick={() => void deleteTable(table.id)}>{busy ? "Deleting…" : "Confirm delete"}</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmDelete(null)}>Keep table</button>
          </div>
        </div>}

        {open && confirmDelete !== table.id && <div className="mt-2">
          <TableGrid
            table={table}
            disabled={disabled || busy}
            recurring={recurring}
            onCells={(cells) => void writeCells(table.id, cells)}
            onAddRow={() => void mutate(table, { action: "add_row" })}
            onAddColumn={() => void mutate(table, { action: "add_column", column: { name: `Column ${table.columns.length + 1}`, type: "text" } })}
            onDeleteRow={(rowId) => void mutate(table, { action: "delete_row", rowId })}
            onMoveRow={(rowId, direction) => void mutate(table, { action: "move_row", rowId, direction })}
            onRowCarryForward={(rowId, carryForward) => void mutate(table, { action: "set_row_carry_forward", rowId, carryForward })}
            onUpdateColumn={(columnId, patch) => updateColumn(table, columnId, patch)}
            onMoveColumn={(columnId, direction) => void mutate(table, { action: "move_column", columnId, direction })}
            onDeleteColumn={(columnId) => void mutate(table, { action: "delete_column", columnId })}
          />
        </div>}
      </article>;
    })}

    {busy && <p role="status" className="mt-1 text-xs text-slate-500">Saving…</p>}

    {adding && <AddTableDialog recurring={recurring} busy={busy} onClose={() => setAdding(false)} onCreate={createTable} />}
  </section>;
}
