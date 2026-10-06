import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ObjectDrawer } from "@/components/board/ObjectDrawer";
import type { ManagedObject } from "@/lib/types/object";

const base: ManagedObject = {
  id: "workspace-fixture", title: "Make a desk", goal: "Build a wooden computer desk", status: "doing", position: 0,
  category: null, archivedAt: null, cancelledAt: null, currentState: "Dimensions confirmed", nextAction: "Choose wood",
  occurrenceNote: null, recurrence: null, unresolvedDependencies: 0,
  checklist: [{ id: "step-1", title: "Choose wood", parentId: null, completed: false, position: 0, estimatedMinutes: null }],
};
const initial = { ...base, ...(window as unknown as { workspaceInitial?: Partial<ManagedObject> }).workspaceInitial };
const noop = async () => {};

function Harness() {
  const [object, setObject] = useState<ManagedObject>(initial);
  const [open, setOpen] = useState(true);
  const [version, setVersion] = useState(0);
  return <>
    <button onClick={() => setOpen(true)}>Open workspace</button>
    <button onClick={() => setVersion((current) => current + 1)}>Refresh tables fixture</button>
    <button onClick={() => setObject({ ...base, id: "second-object", title: "Make a video" })}>Switch Object fixture</button>
    <ObjectDrawer object={open ? object : null} activityVersion={version} onClose={() => setOpen(false)}
      onObjectUpdated={setObject} onRefreshActivity={() => setVersion((current) => current + 1)}
      onToggleChecklist={noop} onEditField={noop} onAddChecklist={noop} onRenameChecklist={noop} onDeleteChecklist={noop}
      onReorderChecklist={noop} onApplyProgress={noop} onApplyReplan={async (id, proposal) => {
        const response = await fetch(`/api/ai/objects/${id}/replan/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposal }) });
        if (!response.ok) throw new Error("Apply failed");
        setObject((await response.json()).object);
        setVersion((current) => current + 1);
      }} onLifecycle={noop}
      onCategoryChange={noop} onDeleteObject={noop} onOpenObject={() => {}}
      onUpdateNote={async (_id, note) => setObject((current) => ({ ...current, occurrenceNote: note }))}
      onUpdateRecurrence={async (_id, config) => setObject((current) => ({ ...current, recurrence: config ? { ...config, seriesId: current.id, previousOccurrenceId: null, nextOccurrenceId: null } : null }))}
    />
  </>;
}

createRoot(document.getElementById("root")!).render(<Harness />);