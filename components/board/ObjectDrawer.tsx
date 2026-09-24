"use client";
import { useRef, useState } from "react";
import { ActivityLog } from "@/components/activity/ActivityLog";
import { Checklist } from "@/components/checklist/Checklist";
import { ObjectAI } from "@/components/ai/ObjectAI";
import { InlineEditableField } from "@/components/ui/InlineEditableField";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";
import { CategorySelect } from "@/components/categories/CategorySelect";
import { DependenciesSection } from "@/components/dependencies/DependenciesSection";
import { TablesSection } from "@/components/tables/TablesSection";
import { RecurrenceControls, type RecurrenceFormInput } from "@/components/recurrence/RecurrenceControls";
import { COLUMNS, type ManagedObject } from "@/lib/types/object";

interface ObjectDrawerProps {
  onDeleteObject: (objectId: string) => Promise<void>;
  onCategoryChange: (objectId: string, categoryId: string | null) => Promise<void>;
  onLifecycle: (id: string, action: "archive" | "cancel" | "restore") => Promise<void>;
  object: ManagedObject | null; activityVersion: number; onClose: () => void;
  onToggleChecklist: (objectId: string, itemId: string) => Promise<void>;
  onEditField: (objectId: string, field: "title" | "goal" | "currentState" | "nextAction", value: string) => Promise<void>;
  onAddChecklist: (objectId: string, title: string, parentId?: string | null) => Promise<void>;
  onRenameChecklist: (objectId: string, itemId: string, title: string) => Promise<void>;
  onDeleteChecklist: (objectId: string, itemId: string) => Promise<void>;
  onReorderChecklist: (objectId: string, parentId: string | null, ids: string[]) => Promise<void>;
  onApplyProgress: (objectId: string, update: unknown) => Promise<void>;
  onApplyReplan: (objectId: string, proposal: unknown) => Promise<void>;
  onOpenObject: (objectId: string) => void;
  onUpdateRecurrence: (objectId: string, config: RecurrenceFormInput | null) => Promise<void>;
  onUpdateNote: (objectId: string, note: string) => Promise<void>;
  /** Refreshes the Drawer Activity list after a Table structural change. */
  onRefreshActivity: (objectId: string) => void;
}
export function ObjectDrawer(props: ObjectDrawerProps) {
  return props.object ? <DrawerContent key={props.object.id} {...props} object={props.object} /> : null;
}
function DrawerContent({ object, activityVersion, onClose, onToggleChecklist, onEditField, onAddChecklist, onRenameChecklist, onDeleteChecklist, onReorderChecklist, onApplyProgress, onApplyReplan, onLifecycle, onCategoryChange, onDeleteObject, onOpenObject, onUpdateRecurrence, onUpdateNote, onRefreshActivity }: ObjectDrawerProps & { object: ManagedObject }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lifecycleError, setLifecycleError] = useState("");
  const archived = !!object.archivedAt;
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const completed = object.checklist.filter((item) => item.completed).length;
  const column = COLUMNS.find((item) => item.id === object.status);
  async function manual(action: () => Promise<void>) {
    if (lock.current || pending) throw new Error("Save already pending");
    lock.current = true; setPending(true);
    try { await action(); } finally { lock.current = false; setPending(false); }
  }
  async function lifecycle(action: "archive" | "cancel" | "restore") {
    setLifecycleError(""); try { await manual(() => onLifecycle(object.id, action)); setConfirmDelete(false); } catch { setLifecycleError("Could not save Object action. Please try again."); }
  }
  async function removeObject() {
    setLifecycleError("");
    try { await manual(() => onDeleteObject(object.id)); }
    catch { setLifecycleError("删除失败，对象仍保留，请重试。"); }
  }
  return <WorkspaceDialog label="Object details" onClose={onClose} busy={pending}>
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-7">
      <div><p className="section-label">Object workspace</p><p className="mt-1 text-xs text-slate-500">One complete thing.</p></div>
      <div className="flex flex-wrap items-center justify-end gap-2" aria-label="Object actions">
        {archived ? <button type="button" disabled={pending} className="btn-secondary" onClick={() => void lifecycle("restore")}>{pending ? "Restoring…" : "Restore to Board"}</button> : <>
          <button type="button" disabled={pending} className="btn-secondary" aria-label="Archive Object" title="存档，之后可以恢复" onClick={() => void lifecycle("archive")}>存档</button>
        </>}
        <button type="button" disabled={pending} className="btn-danger" aria-label="Delete Object" title="永久删除对象" onClick={() => setConfirmDelete(true)}>删除</button>
        <button type="button" autoFocus className="btn-secondary" aria-label="Close Object Drawer" disabled={pending} onClick={onClose}>Close <span aria-hidden="true">×</span></button>
      </div>
    </header>
    {(confirmDelete || lifecycleError) && <div className="shrink-0 space-y-2 border-b border-slate-200 px-5 py-3 sm:px-7">
      {confirmDelete && <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
        <p>永久删除“{object.title}”吗？对象、清单和活动记录都会被删除，且无法恢复。</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} className="btn-danger" aria-label="Confirm deletion" onClick={() => void removeObject()}>{pending ? "正在删除…" : "确认删除"}</button>
          <button type="button" disabled={pending} className="btn-secondary" aria-label="Keep Object" onClick={() => setConfirmDelete(false)}>保留对象</button>
        </div>
      </div>}
      {lifecycleError && <p role="alert" className="error-note">{lifecycleError}</p>}
    </div>}
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
      {archived && <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600"><p className="font-medium">Archived{object.cancelledAt ? " · Cancelled" : ""}</p><p>This Object is historical. Restore it to resume editing.</p></div>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">{column?.emoji} {column?.label}</span>
        <CategorySelect value={object.categoryId ?? null} disabled={pending || archived} compact onSave={(id) => manual(() => onCategoryChange(object.id, id))} />
      </div>
      <InlineEditableField label="Title" value={object.title} prominent maxLength={120} disabled={pending || archived} onSave={(value) => manual(() => onEditField(object.id, "title", value))} />
      <div className="mt-3">
        <InlineEditableField label="Goal" value={object.goal} multiline boxed emptyText="+ Add a goal" maxLength={1000} disabled={pending || archived} onSave={(value) => manual(() => onEditField(object.id, "goal", value))} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <InlineEditableField label="Current State" value={object.currentState} multiline maxLength={1000} disabled={pending || archived} onSave={(value) => manual(() => onEditField(object.id, "currentState", value))} />
        <InlineEditableField label="Next Action" value={object.nextAction} multiline maxLength={500} disabled={pending || archived} onSave={(value) => manual(() => onEditField(object.id, "nextAction", value))} />
      </div>
      <div className="mt-3">
        <InlineEditableField label="Occurrence note" value={object.occurrenceNote ?? ""} multiline boxed emptyText="+ Add note" maxLength={2000} disabled={pending || archived} onSave={(value) => manual(() => onUpdateNote(object.id, value))} />
      </div>
      <section aria-label="Checklist" className="mt-4 border-t border-slate-200 pt-3">
        <div className="mb-1 flex items-center justify-between"><h3 className="section-label">Checklist</h3><span className="text-xs tabular-nums text-slate-500">{completed} / {object.checklist.length}</span></div>
        <Checklist items={object.checklist} disabled={pending || archived}
          onToggle={(id) => manual(() => onToggleChecklist(object.id, id))}
          onAdd={(title, parentId) => manual(() => onAddChecklist(object.id, title, parentId))}
          onRename={(id, title) => manual(() => onRenameChecklist(object.id, id, title))}
          onDelete={(id) => manual(() => onDeleteChecklist(object.id, id))}
          onReorder={(parentId, ids) => manual(() => onReorderChecklist(object.id, parentId, ids))} />
      </section>
      <TablesSection objectId={object.id} recurring={!!object.recurrence} disabled={pending || archived} onActivityChange={() => onRefreshActivity(object.id)} />
      <DependenciesSection objectId={object.id} disabled={pending || archived} onOpenObject={onOpenObject} />
      <section aria-label="Recurring" className="mt-4 border-t border-slate-200 pt-3">
        <h3 className="section-label mb-1">Recurring</h3>
        <RecurrenceControls config={object.recurrence} disabled={pending || archived} onSave={(config) => manual(() => onUpdateRecurrence(object.id, config))} />
      </section>
      <div hidden={archived} className="mt-4 border-t border-slate-200 pt-3">
        <ObjectAI object={object} disabled={pending} onPendingChange={setPending} onApplyProgress={onApplyProgress} onApplyReplan={onApplyReplan} />
      </div>
      <ActivityLog objectId={object.id} version={activityVersion} />
    </div>
  </WorkspaceDialog>;
}
