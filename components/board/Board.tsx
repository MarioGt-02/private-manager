"use client";

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { deriveNextAction, withDerivedCompletion } from "@/lib/objects/next-action";
import { COLUMNS, isStatus } from "@/lib/types/object";
import type { ManagedObject } from "@/lib/types/object";
import { Column } from "./Column";
import { ObjectCardOverlay } from "./ObjectCard";
import { CancelDropZone, CANCEL_DROP_ID, ARCHIVE_DROP_ID, OBJECT_DROP_PREFIX, boardCollisionDetection } from "./CancelDropZone";
import { CancelObjectDialog } from "./CancelObjectDialog";
import { ObjectDrawer } from "./ObjectDrawer";
import { ManualCreateDialog } from "./ManualCreateDialog";
import {
  reorderObjectsAction,
  setChecklistItemCompleted,
  updateObjectFieldsAction,
  addChecklistItemAction,
  renameChecklistItemAction,
  deleteChecklistItemAction,
  reorderChecklistItemsAction,
} from "@/lib/actions/object-actions";
import { ArchiveDrawer } from "@/components/archive/ArchiveDrawer";
import { DataExport } from "@/components/data/DataExport";
import type { LifecycleAction } from "@/lib/archive/schemas";
import type { ObjectStatus } from "@/lib/types/object";
import { AICreateDialog } from "@/components/ai/AICreateDialog";
import { reorderBoardObjects } from "@/lib/objects/board-order";
import { ApiError, parseErrorDetail } from "@/lib/errors/client";
import { CategoryProvider, mutateCategory } from "@/components/categories/CategoryContext";
import { CategoryManager } from "@/components/categories/CategoryManager";

interface BoardProps {
  initialObjects: ManagedObject[];
  initialError?: string | null;
}

export function Board({ initialObjects, initialError = null }: BoardProps) {
  return <CategoryProvider><BoardContent initialObjects={initialObjects} initialError={initialError} /></CategoryProvider>;
}
function BoardContent({ initialObjects, initialError = null }: BoardProps) {
  const [managingCategories, setManagingCategories] = useState(false);
  const [activityVersions, setActivityVersions] = useState<Record<string, number>>({});
  function toggleMinimized(id: string) {
    setMinimizedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function refreshActivity(objectId: string) {
    setActivityVersions((versions) => ({ ...versions, [objectId]: (versions[objectId] ?? 0) + 1 }));
  }
  const [objects, setObjects] = useState<ManagedObject[]>(initialObjects.filter((object) => !object.archivedAt));
  const [error, setError] = useState<string | null>(initialError);
  const [archiveStatus, setArchiveStatus] = useState<ObjectStatus | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [historicalObject, setHistoricalObject] = useState<ManagedObject | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Pick<ManagedObject, "id" | "title"> | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isAICreateOpen, setIsAICreateOpen] = useState(false);
  const [isManualCreateOpen, setIsManualCreateOpen] = useState(false);
  const [minimizedIds, setMinimizedIds] = useState<Set<string>>(() => new Set(initialObjects.filter((object) => object.status === "idea").map((object) => object.id)));
  const [pendingCompleteIds, setPendingCompleteIds] = useState<Set<string>>(new Set());

  // Distinguishes a real drag from a plain click so dragging a card does not
  // accidentally open the drawer afterwards.
  const didDrag = useRef(false);
  const cancelDialogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (cancelDialogTimer.current) clearTimeout(cancelDialogTimer.current); }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const selectedObject = historicalObject ?? objects.find((o) => o.id === selectedId) ?? null;
  const activeObject = objects.find((o) => o.id === activeId) ?? null;
  function handleSelect(id: string) {
    if (didDrag.current) {
      didDrag.current = false;
      return;
    }
    setSelectedId(id);
  }

  function handleDragStart(event: DragStartEvent) {
    if (cancelDialogTimer.current) clearTimeout(cancelDialogTimer.current);
    didDrag.current = true;
    setActiveId(String(event.active.id));
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    window.setTimeout(() => { didDrag.current = false; }, 0);

    if (!over) return;

    const objectId = String(active.id);
    if (over.id === CANCEL_DROP_ID) {
      const object = objects.find((item) => item.id === objectId);
      if (object) {
        // PointerSensor suppresses clicks for 50ms after drop. Open after it
        // detaches so the first confirmation/keep click is not swallowed.
        if (cancelDialogTimer.current) clearTimeout(cancelDialogTimer.current);
        cancelDialogTimer.current = setTimeout(() => { setCancelTarget({ id: object.id, title: object.title }); cancelDialogTimer.current = null; }, 60);
      }
      return; // Drop only requests confirmation; no status/DB mutation yet.
    }

    if (over.id === ARCHIVE_DROP_ID) {
      const object = objects.find((item) => item.id === objectId);
      if (object) {
        const previousObjects = objects;
        setObjects((items) => items.filter((item) => item.id !== objectId));
        setError(null);
        try {
          await handleLifecycle(objectId, "archive");
        } catch {
          setObjects(previousObjects);
          setError("Could not archive the Object. Please try again.");
        }
      }
      return;
    }
    const overId = String(over.id);
    const targetObjectId = overId.startsWith(OBJECT_DROP_PREFIX)
      ? String(over.data.current?.objectId ?? "") || null
      : null;
    const newStatus = targetObjectId
      ? String(over.data.current?.status ?? "")
      : overId;
    if (!isStatus(newStatus)) return;

    const previousObjects = objects;
    const translated = active.rect.current.translated;
    const insertAfter = targetObjectId && translated
      ? translated.top + translated.height / 2 > over.rect.top + over.rect.height / 2
      : false;
    const reordered = reorderBoardObjects(objects, objectId, newStatus, targetObjectId, insertAfter);
    if (!reordered) return;
    const currentTargetIds = objects.filter((object) => object.status === newStatus).map((object) => object.id);
    if (currentTargetIds.length === reordered.orderedObjectIds.length && currentTargetIds.every((id, index) => id === reordered.orderedObjectIds[index])) return;

    setObjects(reordered.objects);
    setError(null);

    try {
      await reorderObjectsAction({ objectId, targetStatus: newStatus, orderedObjectIds: reordered.orderedObjectIds });
      refreshActivity(objectId);
    } catch {
      setObjects(previousObjects);
      setError("Could not save the Object's position. Please try again.");
    }
  }

  function handleDragCancel() {
    didDrag.current = false;
    setActiveId(null);
  }

  async function handleToggleChecklist(objectId: string, itemId: string) {
    const object = objects.find((o) => o.id === objectId);
    const item = object?.checklist.find((i) => i.id === itemId);
    if (!object || !item) return;

    const nextCompleted = !item.completed;

    // Optimistic update for instant feedback.
    const updatedChecklist = withDerivedCompletion(object.checklist.map((i) => i.id === itemId ? { ...i, completed: nextCompleted } : i));
    setObjects((prev) => prev.map((o) => o.id === objectId ? { ...o, checklist: updatedChecklist, currentState: `${nextCompleted ? "已完成" : "已重新打开"}：${item.title}`, nextAction: deriveNextAction(updatedChecklist) } : o));
    setError(null);

    try {
      await setChecklistItemCompleted(itemId, nextCompleted); refreshActivity(objectId);
    } catch {
      // Revert on failure so the UI reflects the real database state.
      setObjects((prev) =>
        prev.map((o) =>
          o.id === objectId
              ? { ...o, checklist: withDerivedCompletion(o.checklist.map((i) => i.id === itemId ? { ...i, completed: item.completed } : i)), currentState: object.currentState, nextAction: object.nextAction }
            : o,
        ),
      );
      throw new Error("Could not save checklist changes.");
    }
  }

  async function handleCompleteNextAction(objectId: string, itemId: string) {
    const object = objects.find((o) => o.id === objectId);
    const item = object?.checklist.find((i) => i.id === itemId);
    if (!object || !item || item.completed) return;

    const updatedChecklist = withDerivedCompletion(object.checklist.map((i) => i.id === itemId ? { ...i, completed: true } : i));
    setPendingCompleteIds((current) => new Set(current).add(objectId));
    setObjects((prev) => prev.map((o) => o.id === objectId ? { ...o, checklist: updatedChecklist, currentState: `已完成：${item.title}`, nextAction: deriveNextAction(updatedChecklist) } : o));
    setError(null);

    try {
      await setChecklistItemCompleted(itemId, true);
      refreshActivity(objectId);
    } catch {
      setObjects((prev) => prev.map((o) => o.id === objectId ? object : o));
      setError("Could not complete the checklist item. Please try again.");
    } finally {
      setPendingCompleteIds((current) => { const next = new Set(current); next.delete(objectId); return next; });
    }
  }

  async function handleEditField(objectId: string, field: "title" | "goal" | "currentState" | "nextAction", value: string) {
    const previous = objects.find((item) => item.id === objectId);
    if (!previous) return;
    setObjects((items) => items.map((item) => item.id === objectId ? { ...item, [field]: value } : item));
    try { const saved = await updateObjectFieldsAction({ objectId, field, value }); setObjects((items) => items.map((item) => item.id === objectId ? { ...item, [field]: saved[field] } : item)); refreshActivity(objectId); } catch { setObjects((items) => items.map((item) => item.id === objectId ? { ...item, [field]: previous[field] } : item)); throw new Error("Could not save changes."); }
  }

  async function handleAddChecklist(objectId: string, title: string, parentId?: string | null) {
    try { const item = await addChecklistItemAction(objectId, title, parentId); refreshActivity(objectId); setObjects((items) => items.map((object) => object.id === objectId ? { ...object, checklist: withDerivedCompletion([...object.checklist, item]), nextAction: deriveNextAction([...object.checklist, item]) } : object)); } catch { throw new Error("Could not add the checklist item."); }
  }

  async function handleRenameChecklist(objectId: string, itemId: string, title: string) {
    const previous = objects.find((object) => object.id === objectId);
    if (!previous) return;
    setObjects((items) => items.map((object) => object.id === objectId ? { ...object, checklist: object.checklist.map((item) => item.id === itemId ? { ...item, title } : item) } : object));
    try { const saved = await renameChecklistItemAction({ objectId, itemId, title }); setObjects((items) => items.map((object) => { if (object.id !== objectId) return object; const checklist = object.checklist.map((item) => item.id === itemId ? saved : item); return { ...object, checklist, nextAction: deriveNextAction(checklist) }; })); refreshActivity(objectId); } catch { setObjects((items) => items.map((object) => object.id === objectId ? previous : object)); throw new Error("Could not rename the checklist item."); }
  }

  async function handleDeleteChecklist(objectId: string, itemId: string) {
    const previous = objects.find((object) => object.id === objectId);
    if (!previous) return;
    setObjects((items) => items.map((object) => object.id === objectId ? { ...object, checklist: object.checklist.filter((item) => item.id !== itemId) } : object));
    try { await deleteChecklistItemAction({ objectId, itemId }); setObjects((items) => items.map((object) => object.id === objectId ? { ...object, nextAction: deriveNextAction(object.checklist) } : object)); refreshActivity(objectId); } catch { setObjects((items) => items.map((object) => object.id === objectId ? previous : object)); throw new Error("Could not delete the checklist item."); }
  }

  async function handleReorderChecklist(objectId: string, parentId: string | null, ids: string[]) {
    const previous = objects.find((object) => object.id === objectId);
    if (!previous) return;
    const updatedChecklist = previous.checklist.map((item) => { const index = ids.indexOf(item.id); return index >= 0 ? { ...item, position: index } : item; });
    setObjects((items) => items.map((object) => object.id === objectId ? { ...object, checklist: updatedChecklist, nextAction: deriveNextAction(updatedChecklist) } : object));
    try { await reorderChecklistItemsAction({ objectId, parentId, orderedItemIds: ids }); refreshActivity(objectId); } catch { setObjects((items) => items.map((object) => object.id === objectId ? previous : object)); throw new Error("Could not reorder the checklist."); }
  }
  async function handleApplyProgress(objectId: string, update: unknown) {
    const response = await fetch(`/api/ai/objects/${objectId}/progress/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ update }) });
    const data = await response.json(); if (!response.ok) throw new ApiError(parseErrorDetail(data, "Could not apply update."));
    setObjects((items) => items.map((item) => item.id === objectId ? data.object : item)); refreshActivity(objectId);
  }
  async function handleApplyReplan(objectId: string, proposal: unknown) { const response = await fetch(`/api/ai/objects/${objectId}/replan/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposal }) }); const data = await response.json(); if (!response.ok) throw new ApiError(parseErrorDetail(data, "Could not apply replan.")); setObjects((items) => items.map((item) => item.id === objectId ? data.object : item)); refreshActivity(objectId); }

  async function openArchivedObject(id: string) {
    const response = await fetch(`/api/objects/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load archived Object.");
    const data = await response.json(); setHistoricalObject(data.object); setSelectedId(null);
  }
  async function handleLifecycle(id: string, action: LifecycleAction) {
    const response = await fetch(`/api/objects/${encodeURIComponent(id)}/lifecycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(action === "cancel" ? { confirmed: true } : {}) }) });
    if (!response.ok) throw new Error("Could not save Object action.");
    const { object }: { object: ManagedObject } = await response.json();
    setObjects((items) => object.archivedAt ? items.filter((item) => item.id !== id) : items.some((item) => item.id === id) ? items.map((item) => item.id === id ? object : item) : [...items, object]);
    setHistoricalObject(null); setHistoryVersion((version) => version + 1); refreshActivity(id);
    if (object.archivedAt) { setSelectedId(null); setArchiveStatus(object.status); }
    else if (selectedObject?.id === id) setSelectedId(id);
  }
  function handleObjectCreated(object: ManagedObject) {
    setObjects((prev) => [...prev, object]);
    setHistoricalObject(null);
    setSelectedId(object.id);
    setIsAICreateOpen(false);
    setIsManualCreateOpen(false);
  }

  async function handleDeleteObject(id: string) {
    const response = await fetch(`/api/objects/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
    });
    if (!response.ok) throw new Error("Could not delete Object.");
    setObjects((items) => items.filter((item) => item.id !== id));
    setSelectedId(null);
    setHistoricalObject(null);
    setHistoryVersion((version) => version + 1);
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-white">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-base font-semibold text-slate-900">
            Private Manager
          </h1>
          <p className="hidden text-xs text-slate-500 sm:block">
            One object, one complete thing.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button className="btn-secondary" onClick={() => setManagingCategories(true)}>Categories</button>
          <DataExport />
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="btn-secondary">Logout</button>
          </form>
          <button type="button" className="btn-secondary" onClick={() => setIsManualCreateOpen(true)}>＋ 手动添加</button>
          <button
            type="button"
            onClick={() => setIsAICreateOpen(true)}
            className="btn-primary"
          >
            ✨ AI Create
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {error && (
          <div
            role="alert"
            className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="ml-3 text-red-100 transition-colors hover:text-white"
            >
              ×
            </button>
          </div>
        )}

        <DndContext id="private-manager-board"
          sensors={sensors}
          collisionDetection={boardCollisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="flex h-full items-start gap-3 overflow-x-auto overflow-y-auto bg-slate-50 p-4 sm:gap-4 sm:p-5">
            {COLUMNS.map((column) => (
              <Column
                key={column.id}
                column={column}
                objects={objects.filter((o) => o.status === column.id)}
                onSelect={handleSelect}
                selectedId={selectedId}
                minimizedIds={minimizedIds}
                pendingIds={pendingCompleteIds}
                onToggleMinimize={toggleMinimized}
                onCompleteNextAction={handleCompleteNextAction}
                onArchive={() => { setArchiveStatus(column.id); setSelectedId(null); setHistoricalObject(null); }}
              />
            ))}
          </div>

          <CancelDropZone active={activeId !== null} />
          <DragOverlay zIndex={30} style={{ pointerEvents: "none" }}>
            {activeObject ? <ObjectCardOverlay object={activeObject} minimized={minimizedIds.has(activeObject.id)} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {archiveStatus && <ArchiveDrawer key={archiveStatus} status={archiveStatus} version={historyVersion} onClose={() => setArchiveStatus(null)} onOpen={openArchivedObject} onRestore={(id) => handleLifecycle(id, "restore")} onDelete={handleDeleteObject} />}
      <ObjectDrawer
        onDeleteObject={handleDeleteObject}
        onCategoryChange={async (objectId, categoryId) => {
          await mutateCategory({ action: "assign", objectId, categoryId });
          setObjects((items) => items.map((item) => item.id === objectId ? { ...item, categoryId } : item));
          refreshActivity(objectId);
        }}
        object={selectedObject}
        activityVersion={selectedObject ? activityVersions[selectedObject.id] ?? 0 : 0}
        onClose={() => { setSelectedId(null); setHistoricalObject(null); }}
        onToggleChecklist={handleToggleChecklist}
        onEditField={handleEditField}
        onAddChecklist={handleAddChecklist}
        onRenameChecklist={handleRenameChecklist}
        onDeleteChecklist={handleDeleteChecklist}
        onReorderChecklist={handleReorderChecklist}
        onApplyProgress={handleApplyProgress}
        onApplyReplan={handleApplyReplan}
        onLifecycle={handleLifecycle}
      />

      {cancelTarget && <CancelObjectDialog key={cancelTarget.id} object={cancelTarget} onClose={() => setCancelTarget(null)} onConfirm={() => handleLifecycle(cancelTarget.id, "cancel")} />}

      {isManualCreateOpen && <ManualCreateDialog onClose={() => setIsManualCreateOpen(false)} onCreated={handleObjectCreated} />}
      <AICreateDialog
        open={isAICreateOpen}
        onClose={() => setIsAICreateOpen(false)}
        onCreated={handleObjectCreated}
      />
      {managingCategories && <CategoryManager onClose={() => setManagingCategories(false)} />}
    </main>
  );
}

