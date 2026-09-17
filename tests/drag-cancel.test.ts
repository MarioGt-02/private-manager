import { describe, expect, it, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ pointer: vi.fn(), rectangle: vi.fn() }));
vi.mock("@dnd-kit/core", () => ({ pointerWithin: mocks.pointer, rectIntersection: mocks.rectangle, useDroppable: vi.fn() }));
import { CANCEL_DROP_ID, ARCHIVE_DROP_ID, boardCollisionDetection } from "@/components/board/CancelDropZone";
import { CancelObjectDialog } from "@/components/board/CancelObjectDialog";
const args = { droppableContainers: [{ id: "doing" }, { id: CANCEL_DROP_ID }, { id: ARCHIVE_DROP_ID }, { id: "ready" }] } as Parameters<typeof boardCollisionDetection>[0];
beforeEach(() => { vi.clearAllMocks(); });
describe("Drag cancellation", () => {
  it("prioritizes the cancel target only when the pointer is inside it", () => {
    mocks.pointer.mockReturnValue([{ id: "doing" }, { id: CANCEL_DROP_ID }]);
    expect(boardCollisionDetection(args)).toEqual([{ id: CANCEL_DROP_ID }]);
    expect(mocks.rectangle).not.toHaveBeenCalled();
  });
  it("prioritizes the archive target only when the pointer is inside it", () => {
    mocks.pointer.mockReturnValue([{ id: "doing" }, { id: ARCHIVE_DROP_ID }]);
    expect(boardCollisionDetection(args)).toEqual([{ id: ARCHIVE_DROP_ID }]);
    expect(mocks.rectangle).not.toHaveBeenCalled();
  });
  it("preserves normal column collision and excludes cancel target from rectangle overlap", () => {
    mocks.pointer.mockReturnValue([]); mocks.rectangle.mockReturnValue([{ id: "ready" }]);
    expect(boardCollisionDetection(args)).toEqual([{ id: "ready" }]);
    expect(mocks.rectangle.mock.calls[0][0].droppableContainers.map((item: {id:string}) => item.id)).toEqual(["doing", "ready"]);
  });
  it("rendering confirmation does not cancel anything and describes restoration", () => {
    const confirm=vi.fn(); const close=vi.fn();
    const html=renderToStaticMarkup(createElement(CancelObjectDialog,{object:{id:"example",title:"制作视频"},onConfirm:confirm,onClose:close}));
    expect(html).toContain("制作视频");expect(html).toContain("确认取消");expect(html).toContain("保留卡片");expect(html).toContain("之后可以恢复");
    expect(confirm).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
  });
});
