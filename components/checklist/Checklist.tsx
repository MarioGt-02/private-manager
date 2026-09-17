"use client";
import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ChecklistItem } from "@/lib/types/object";

interface ChecklistProps {
  items: ChecklistItem[];
  disabled?: boolean;
  onToggle: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAdd: (title: string, parentId?: string | null) => Promise<void>;
  onReorder: (parentId: string | null, ids: string[]) => Promise<void>;
}

export function Checklist({ items, disabled, onToggle, onRename, onDelete, onAdd, onReorder }: ChecklistProps) {
  const [topTitle, setTopTitle] = useState("");
  const [childParent, setChildParent] = useState<string | null>(null);
  const [childTitle, setChildTitle] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedCompleted, setExpandedCompleted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  const { topLevel, childrenByParent, parentIds } = useMemo(() => {
    const top = items.filter((i) => i.parentId == null).sort((a, b) => a.position - b.position);
    const map = new Map<string, ChecklistItem[]>();
    const ids = new Set<string>();
    for (const item of items) {
      if (item.parentId == null) continue;
      ids.add(item.parentId);
      const list = map.get(item.parentId) ?? [];
      list.push(item);
      map.set(item.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return { topLevel: top, childrenByParent: map, parentIds: ids };
  }, [items]);

  async function perform(action: () => Promise<void>): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch {
      setError("Could not save checklist changes. Please try again.");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function move(item: ChecklistItem, siblings: ChecklistItem[], direction: number) {
    const index = siblings.findIndex((s) => s.id === item.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblings.length) return;
    const ids = siblings.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void perform(() => onReorder(item.parentId, ids));
  }

  function toggleExpanded(id: string) {
    setExpandedCompleted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const incomplete = topLevel.filter((p) => !p.completed);
  const complete = topLevel.filter((p) => p.completed);
  const completedCount = items.filter((i) => i.completed).length;

  function renderItem(item: ChecklistItem, siblings: ChecklistItem[], depth: number, collapsible = false) {
    const isParent = parentIds.has(item.id);
    const children = childrenByParent.get(item.id) ?? [];
    const someChildrenDone = isParent && children.some((c) => c.completed);
    const collapsed = collapsible && isParent && !expandedCompleted.has(item.id);

    return (
      <div key={item.id}>
        <div className="group flex items-center gap-1.5 py-1" style={{ paddingLeft: depth * 20 }}>
          {collapsible && isParent && (
            <button
              type="button"
              onClick={() => toggleExpanded(item.id)}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${item.title}`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
            </button>
          )}
          <input
            type="checkbox"
            checked={item.completed}
            disabled={disabled || busy || isParent}
            onChange={() => void perform(() => onToggle(item.id))}
            aria-label={`Complete: ${item.title}`}
            ref={(el) => {
              if (el) el.indeterminate = isParent && someChildrenDone && !item.completed;
            }}
            className="h-4 w-4 shrink-0 cursor-pointer accent-indigo-600 disabled:cursor-default"
          />
          <InlineTitle
            value={item.title}
            completed={item.completed}
            disabled={disabled || busy}
            onSave={async (value) => {
              const ok = await perform(() => onRename(item.id, value));
              if (!ok) throw new Error("Save failed");
            }}
          />
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <IconButton label={`Move ${item.title} up`} disabled={disabled || busy || siblings.findIndex((s) => s.id === item.id) === 0} onClick={() => move(item, siblings, -1)}>↑</IconButton>
            <IconButton label={`Move ${item.title} down`} disabled={disabled || busy || siblings.findIndex((s) => s.id === item.id) === siblings.length - 1} onClick={() => move(item, siblings, 1)}>↓</IconButton>
            {depth === 0 && (
              <IconButton label={`Add sub-item to ${item.title}`} disabled={disabled || busy} onClick={() => { setChildParent(item.id); setChildTitle(""); }}>↳</IconButton>
            )}
            <IconButton label={`Delete ${item.title}`} disabled={disabled || busy} onClick={() => void perform(() => onDelete(item.id))}>×</IconButton>
          </div>
        </div>

        {childParent === item.id && (
          <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: (depth + 1) * 20 }}>
            <input
              autoFocus
              value={childTitle}
              onChange={(e) => setChildTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (childTitle.trim()) {
                    void perform(() => onAdd(childTitle.trim(), item.id)).then((ok) => {
                      if (ok) { setChildTitle(""); setChildParent(null); }
                    });
                  }
                } else if (e.key === "Escape") {
                  setChildParent(null);
                  setChildTitle("");
                }
              }}
              onBlur={() => {
                if (childTitle.trim()) {
                  void perform(() => onAdd(childTitle.trim(), item.id)).then((ok) => {
                    if (ok) { setChildTitle(""); setChildParent(null); }
                  });
                } else {
                  setChildParent(null);
                }
              }}
              placeholder="Sub-item"
              className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-0.5 text-sm text-slate-700 outline-none"
            />
          </div>
        )}

        {!collapsed && children.map((child) => renderItem(child, children, depth + 1))}
      </div>
    );
  }

  return (
    <div aria-busy={busy}>
      <div className="min-w-0 space-y-0.5">
        {items.length === 0 && <p className="py-2 text-sm text-slate-400">No checklist items yet.</p>}
        {incomplete.map((item) => renderItem(item, topLevel, 0))}
        {complete.length > 0 && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              aria-expanded={showCompleted}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              <span aria-hidden="true">{showCompleted ? "▾" : "▸"}</span>
              Completed ({completedCount})
            </button>
            {showCompleted && complete.map((item) => renderItem(item, topLevel, 0, true))}
          </div>
        )}
      </div>

      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (topTitle.trim() && (await perform(() => onAdd(topTitle.trim(), null)))) setTopTitle("");
        }}
      >
        <input
          value={topTitle}
          onChange={(e) => setTopTitle(e.target.value)}
          maxLength={300}
          placeholder="Add checklist item"
          disabled={disabled || busy}
          className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 text-sm text-slate-700 outline-none focus:border-indigo-400"
        />
        <button
          type="submit"
          disabled={!topTitle.trim() || disabled || busy}
          className="rounded px-2 py-1 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-40"
        >
          Add
        </button>
      </form>

      {busy && <p role="status" className="mt-1 text-xs text-slate-500">Saving…</p>}
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function InlineTitle({ value, completed, disabled, onSave }: {
  value: string;
  completed: boolean;
  disabled: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const saving = useRef(false);

  async function commit() {
    if (saving.current) return;
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      return;
    }
    saving.current = true;
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      // keep editing so the user can fix the title
    } finally {
      saving.current = false;
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
        className="min-w-0 flex-1 rounded border border-indigo-300 px-1.5 py-0.5 text-sm text-slate-700 outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { setDraft(value); setEditing(true); }}
      title={value}
      className={`min-w-0 flex-1 truncate px-1.5 py-0.5 text-left text-sm ${completed ? "text-slate-400 line-through" : "text-slate-700"}`}
    >
      {value}
    </button>
  );
}

function IconButton({ label, disabled, onClick, children }: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
