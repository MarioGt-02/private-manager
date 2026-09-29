import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ObjectDrawer } from "@/components/board/ObjectDrawer";
import { CardBody } from "@/components/board/ObjectCard";
import type { ManagedObject } from "@/lib/types/object";
const object: ManagedObject = {
  id: "fixture-object", title: "Life Assistant 核心框架", goal: "Build a usable reminder", status: "doing", position: 0,
  category: null, archivedAt: null, cancelledAt: null, currentState: "No framework yet", nextAction: "Implement API", occurrenceNote: null, recurrence: null, unresolvedDependencies: 0,
  checklist: [
    { id: "a", title: "Implement API", parentId: null, completed: false, position: 0, estimatedMinutes: null },
    { id: "b", title: "Test integration", parentId: null, completed: false, position: 1, estimatedMinutes: null },
  ],
};
Object.assign(window, { estimateFixture: structuredClone(object), estimateWrites: 0 });
const noop = async () => {};
function Harness() {
  const [current, setCurrent] = useState(object);
  const [open, setOpen] = useState(true);
  return <><article data-testid="card" className="m-4 w-72"><CardBody object={current} /></article><button onClick={() => setOpen(true)}>Open workspace</button><ObjectDrawer object={open ? current : null} onObjectUpdated={setCurrent} onClose={() => setOpen(false)} activityVersion={0} onRefreshActivity={() => {}} onDeleteObject={noop} onCategoryChange={noop} onLifecycle={noop} onToggleChecklist={noop} onEditField={noop} onAddChecklist={noop} onRenameChecklist={noop} onDeleteChecklist={noop} onReorderChecklist={noop} onApplyProgress={noop} onApplyReplan={noop} onOpenObject={() => {}} onUpdateRecurrence={noop} onUpdateNote={noop} /></>;
}
createRoot(document.getElementById("root")!).render(<Harness />);