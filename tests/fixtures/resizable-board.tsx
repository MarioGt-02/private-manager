import { createRoot } from "react-dom/client";
import { Board } from "@/components/board/Board";
import { fixture } from "./ui-actions";
const original = fixture.objects[0];
fixture.objects = Array.from({ length: 6 }, (_, index) => ({ ...structuredClone(original), id: index ? `resize-${index}` : original.id, title: `Object ${index + 1} — 可调整宽度的状态列`, status: "ready", position: index, currentState: "已完成准备工作。".repeat(index === 0 ? 20 : index === 3 ? 12 : 1), nextAction: "完成下一步。" }));
createRoot(document.getElementById("root")!).render(<Board initialObjects={structuredClone(fixture.objects)} />);
