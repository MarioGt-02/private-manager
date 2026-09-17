"use client";
import { pointerWithin, rectIntersection, useDroppable, type CollisionDetection } from "@dnd-kit/core";

export const CANCEL_DROP_ID = "__cancel-object-dropzone__";
export const ARCHIVE_DROP_ID = "__archive-object-dropzone__";
export const OBJECT_DROP_PREFIX = "__object-drop__:";
export const objectDropId = (objectId: string) => `${OBJECT_DROP_PREFIX}${objectId}`;

/** The pointer entering an archive or cancel target requests that action. Other
 * drops retain dnd-kit's original rectangle intersection behavior for columns. */
export const boardCollisionDetection: CollisionDetection = (args) => {
  const special = pointerWithin(args).filter((collision) => collision.id === CANCEL_DROP_ID || collision.id === ARCHIVE_DROP_ID);
  if (special.length) return special;
  const objectTargets = pointerWithin(args).filter((collision) => String(collision.id).startsWith(OBJECT_DROP_PREFIX));
  if (objectTargets.length) return objectTargets;
  return rectIntersection({ ...args, droppableContainers: args.droppableContainers.filter((container) => container.id !== CANCEL_DROP_ID && container.id !== ARCHIVE_DROP_ID) });
};

export function CancelDropZone({ active }: { active: boolean }) {
  const { setNodeRef: archiveRef, isOver: archiveOver } = useDroppable({ id: ARCHIVE_DROP_ID, disabled: !active });
  const { setNodeRef: cancelRef, isOver: cancelOver } = useDroppable({ id: CANCEL_DROP_ID, disabled: !active });
  if (!active) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-40 flex w-[min(540px,calc(100vw-32px))] -translate-x-1/2 gap-3">
      <div ref={archiveRef} aria-label="拖拽存档区域" className={`flex-1 rounded-xl border-2 border-dashed px-4 py-4 text-center shadow-sm transition-colors ${archiveOver ? "border-indigo-600 bg-indigo-100" : "border-slate-400 bg-white"}`}>
        <p className="text-sm font-semibold text-slate-800">{archiveOver ? "松手后存档" : "拖到这里存档"}</p>
        <p className="mt-1 text-xs text-slate-600">仅归档，保留状态，之后可恢复</p>
      </div>
      <div ref={cancelRef} aria-label="拖拽取消区域" className={`flex-1 rounded-xl border-2 border-dashed px-4 py-4 text-center shadow-sm transition-colors ${cancelOver ? "border-amber-600 bg-amber-100" : "border-slate-400 bg-white"}`}>
        <p className="text-sm font-semibold text-slate-800">{cancelOver ? "松手后确认取消" : "拖到这里取消"}</p>
        <p className="mt-1 text-xs text-slate-600">确认后取消并存档</p>
      </div>
    </div>
  );
}
