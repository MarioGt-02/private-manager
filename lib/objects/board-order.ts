import { COLUMNS, type ManagedObject, type ObjectStatus } from "@/lib/types/object";

export function reorderBoardObjects(
  objects: ManagedObject[],
  objectId: string,
  targetStatus: ObjectStatus,
  targetObjectId: string | null,
  insertAfter: boolean,
  visibleObjectIds?: Set<string>,
): { objects: ManagedObject[]; orderedObjectIds: string[] } | null {
  const moving = objects.find((object) => object.id === objectId);
  if (!moving) return null;

  if (visibleObjectIds) {
    return reorderFilteredBoardObjects(objects, objectId, targetStatus, targetObjectId, insertAfter, visibleObjectIds);
  }

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

function mergeVisibleOrder(fullColumn: ManagedObject[], desiredVisibleIds: string[], visibleObjectIds: Set<string>): ManagedObject[] {
  const desired = desiredVisibleIds.map((id) => fullColumn.find((object) => object.id === id)).filter((object): object is ManagedObject => !!object);
  const result: ManagedObject[] = [];
  let visibleIndex = 0;
  for (const object of fullColumn) {
    if (visibleObjectIds.has(object.id)) result.push(desired[visibleIndex++]);
    else result.push(object);
  }
  while (visibleIndex < desired.length) result.push(desired[visibleIndex++]);
  return result;
}

function reorderFilteredBoardObjects(
  objects: ManagedObject[],
  objectId: string,
  targetStatus: ObjectStatus,
  targetObjectId: string | null,
  insertAfter: boolean,
  visibleObjectIds: Set<string>,
): { objects: ManagedObject[]; orderedObjectIds: string[] } | null {
  const moving = objects.find((object) => object.id === objectId);
  if (!moving) return null;
  const sameColumn = moving.status === targetStatus;
  const targetColumn = objects.filter((object) => object.status === targetStatus);
  const targetVisibleWithoutMoving = targetColumn
    .filter((object) => visibleObjectIds.has(object.id) && object.id !== objectId)
    .map((object) => object.id);
  let insertionIndex = targetVisibleWithoutMoving.length;
  if (targetObjectId) {
    const targetIndex = targetVisibleWithoutMoving.indexOf(targetObjectId);
    if (targetIndex >= 0) insertionIndex = targetIndex + (insertAfter ? 1 : 0);
  }
  const targetVisible = [...targetVisibleWithoutMoving];
  targetVisible.splice(insertionIndex, 0, objectId);

  const desiredByStatus = new Map<ObjectStatus, string[]>();
  for (const column of COLUMNS) {
    const ids = objects.filter((object) => object.status === column.id && visibleObjectIds.has(object.id) && object.id !== objectId).map((object) => object.id);
    desiredByStatus.set(column.id, ids);
  }
  desiredByStatus.set(targetStatus, sameColumn ? targetVisible : targetVisibleWithoutMoving);

  const reordered = COLUMNS.flatMap((column) => {
    const fullColumn = objects.filter((object) => object.status === column.id && (sameColumn || object.id !== objectId));
    const desired = desiredByStatus.get(column.id) ?? [];
    const merged = mergeVisibleOrder(fullColumn, desired, visibleObjectIds);
    if (column.id === targetStatus) {
      if (sameColumn) return merged.map((object, position) => ({ ...object, position }));
      const movedObject = { ...moving, status: targetStatus };
      const movedIndex = targetVisible.indexOf(objectId);
      let visibleSeen = 0;
      let inserted = false;
      for (let index = 0; index <= merged.length; index += 1) {
        if (index === merged.length || visibleSeen === movedIndex) {
          merged.splice(index, 0, movedObject);
          inserted = true;
          break;
        }
        if (visibleObjectIds.has(merged[index].id)) visibleSeen += 1;
      }
      if (!inserted) merged.push(movedObject);
    }
    return merged.map((object, position) => ({ ...object, position }));
  });

  return { objects: reordered, orderedObjectIds: reordered.filter((object) => object.status === targetStatus).map((object) => object.id) };
}
