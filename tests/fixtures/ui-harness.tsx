import { createRoot } from "react-dom/client";
import { Board } from "@/components/board/Board";
import { fixture } from "./ui-actions";
if ((window as unknown as { __emptyFixture?: boolean }).__emptyFixture) fixture.objects[0].checklist = [];
createRoot(document.getElementById("root")!).render(<Board initialObjects={structuredClone(fixture.objects)} />);
