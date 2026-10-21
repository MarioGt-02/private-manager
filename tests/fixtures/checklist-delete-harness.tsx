import { createRoot } from "react-dom/client";
import { Board } from "@/components/board/Board";
import { fixture } from "./ui-actions";
fixture.objects[0] = {
  ...fixture.objects[0], title: "Checklist deletion regression", goal: "Accurate progress", currentState: "Seven items will remain", nextAction: "Deleted parent child 0",
  checklist: [
    { id: "deleted-parent", title: "Deleted parent", parentId: null, completed: false, position: 0 },
    ...Array.from({ length: 11 }, (_, i) => ({ id: `deleted-child-${i}`, title: `Deleted parent child ${i}`, parentId: "deleted-parent", completed: false, position: i })),
    ...Array.from({ length: 7 }, (_, i) => ({ id: `kept-${i}`, title: `Kept item ${i}`, parentId: null, completed: i === 6, position: i + 1 })),
  ],
};
createRoot(document.getElementById("root")!).render(<Board initialObjects={structuredClone(fixture.objects)} />);
