import { COLUMNS, type ManagedObject, type ObjectStatus } from "@/lib/types/object";

export function reorderBoardObjects(
  objects: ManagedObject[],
  objectId: string,
  targetStatus: ObjectStatus,
  targetObjectId: string | null,
  insertAfter: boolean,
): { objects: ManagedObject[]; orderedObjectIds: string[] } | null {
  const moving = objects.find((object) => object.id === objectId);
  if (!moving) return null;

  const targetObjects = objects.filter((object) => object.status === targetStatus && object.id !== objectId);
  let insertionIndex = targetObjects.length;
  if (targetObjectId) {
    const targetIndex = targetObjects.findIndex((object) => object.id === targetObjectId);
    if (targetIndex >= 0) insertionIndex = targetIndex + (insertAfter ? 1 : 0);
  }
  targetObjects.splice(insertionIndex, 0, { ...moving, status: targetStatus });

  const normalizedTarget = targetObjects.map((object, position) => ({ ...object, position }));
  const orderedObjectIds = normalizedTarget.map((object) => object.id);
  const reordered = COLUMNS.flatMap((column) => {
    if (column.id === targetStatus) return normalizedTarget;
    return objects
      .filter((object) => object.status === column.id && object.id !== objectId)
      .map((object, position) => ({ ...object, position }));
  });
  return { objects: reordered, orderedObjectIds };
}
