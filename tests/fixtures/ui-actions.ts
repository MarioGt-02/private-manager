import type { ManagedObject } from "@/lib/types/object";
import { deriveNextAction } from "@/lib/objects/next-action";
import { manualCreateObjectSchema } from "@/lib/validation/manual-edit";
const text = "安装120×60cm电竞洞洞板 — Design a calm workspace with a deliberately long bilingual title";
export const fixture = {
  failNext: false,
  events: [] as { id: string; objectId: string; type: string; content: string; createdAt: string }[],
  objects: [{ id: "fixture-object", title: text, status: "doing", position: 0, category: null, archivedAt: null, cancelledAt: null, goal: "整理设备，让每天使用的工具伸手可及。".repeat(18), currentState: "安装位置已确定，工具已经备齐。".repeat(12), nextAction: "Prepare wall mounting hardware", checklist: Array.from({length: 22}, (_, i) => ({ id: `fixture-item-${i}`, title: i === 1 ? "Prepare wall mounting hardware" : `步骤 ${i + 1} · ${"A long checklist item with 中文内容 ".repeat(i === 4 ? 8 : 1)}`, completed: i === 0, position: i })), unresolvedDependencies: 0 } as ManagedObject],
};
Object.assign(window, { uiFixture: fixture });
function current() { return fixture.objects[0]; }
export async function createManualObjectAction(input: unknown) {
  const data = manualCreateObjectSchema.parse(input);
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (fixture.failNext) { fixture.failNext = false; throw new Error("Simulated save failure"); }
  const object: ManagedObject = { ...data, id: crypto.randomUUID(), position: fixture.objects.filter((item) => item.status === data.status).length, category: null, archivedAt: null, cancelledAt: null, checklist: [], unresolvedDependencies: 0 };
  fixture.objects.push(object);
  fixture.events.unshift({ id: crypto.randomUUID(), objectId: object.id, type: "object_created", content: "Object created manually.", createdAt: new Date().toISOString() });
  return structuredClone(object);
}
async function mutate(type: string, change: () => void) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (fixture.failNext) { fixture.failNext = false; throw new Error("Simulated save failure"); }
  change();
  if (["status_changed", "checklist_changed", "object_edited"].includes(type)) fixture.events.unshift({ id: `event-${fixture.events.length}`, objectId: current().id, type, content: "Saved fixture event — " + "历史内容 ".repeat(20), createdAt: new Date().toISOString() });
}
export async function moveObjectToStatus(_id: string, status: ManagedObject["status"]) { await mutate("status_changed", () => { current().status = status; }); }
export async function reorderObjectsAction({objectId,targetStatus,orderedObjectIds}:{objectId:string;targetStatus:ManagedObject["status"];orderedObjectIds:string[]}) {
  const moving = fixture.objects.find((object) => object.id === objectId)!;
  await mutate(moving.status === targetStatus ? "object_reordered" : "status_changed", () => {
    const byId = new Map(fixture.objects.map((object) => [object.id, object]));
    const target = orderedObjectIds.map((id, position) => ({ ...byId.get(id)!, status: targetStatus, position }));
    fixture.objects = [...fixture.objects.filter((object) => object.status !== targetStatus && object.id !== objectId), ...target];
  });
}
export async function setChecklistItemCompleted(id: string, completed: boolean) { await mutate("checklist_changed", () => { const item = current().checklist.find((item) => item.id === id)!; item.completed = completed; current().nextAction = deriveNextAction(current().checklist); }); return {...current().checklist.find((item) => item.id === id)!}; }
export async function updateObjectFieldsAction({field,value}: {field: "title"|"goal"|"currentState"|"nextAction";value:string}) { await mutate(field === "currentState" ? "object_edited" : "plan_edited", () => { current()[field] = value.trim(); }); return structuredClone(current()); }
export async function addChecklistItemAction(_id:string,title:string) { const item = {id:`fixture-added-${current().checklist.length}`,parentId:null,title,completed:false,position:current().checklist.length}; await mutate("checklist_item_added", () => { current().checklist.push(item); }); return item; }
export async function renameChecklistItemAction({itemId,title}:{itemId:string;title:string}) { await mutate("checklist_item_renamed", () => { current().checklist.find((item)=>item.id===itemId)!.title = title; }); return {...current().checklist.find((item)=>item.id===itemId)!}; }
export async function deleteChecklistItemAction({itemId}:{itemId:string}) { await mutate("checklist_item_deleted", () => { current().checklist = current().checklist.filter((item)=>item.id!==itemId); }); }
export async function reorderChecklistItemsAction({orderedItemIds}:{orderedItemIds:string[]}) { await mutate("checklist_reordered", () => { current().checklist = orderedItemIds.map((id,position)=>({...current().checklist.find((item)=>item.id===id)!,position})); }); return structuredClone(current().checklist); }
