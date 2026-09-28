import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MobileBoard } from "@/components/board/MobileBoard";
import { ObjectCard } from "@/components/board/ObjectCard";
import type { ManagedObject } from "@/lib/types/object";

vi.mock("server-only", () => ({}));

function object(id: string, status: ManagedObject["status"]): ManagedObject {
  return {
    id, title: `${id} title`, status, position: 0, category: null, categoryId: null,
    archivedAt: null, cancelledAt: null, goal: "Goal", currentState: "Current state",
    nextAction: "Next action", occurrenceNote: null, unresolvedDependencies: 0,
    recurrence: null, checklist: [{ id: `${id}-item`, parentId: null, title: "Step", completed: false, position: 0 }],
  };
}

const objects = [object("idea", "idea"), object("ready", "ready"), object("doing", "doing"), object("done", "done")];

describe("Mobile Board presentation", () => {
  it("renders all status tabs but only the selected status cards", () => {
    const markup = renderToStaticMarkup(createElement(MobileBoard, {
      objects,
      activeStatus: "doing",
      onStatusChange: vi.fn(),
      onSelect: vi.fn(),
      selectedId: null,
      minimizedIds: new Set<string>(),
      pendingIds: new Set<string>(),
      onToggleMinimize: vi.fn(),
      onCompleteNextAction: vi.fn(),
      onMoveStatus: vi.fn(),
    }));
    expect(markup).toContain('aria-label="Board status tabs"');
    expect(markup).toContain("touch-pan-y");
    expect(markup).toContain("Idea");
    expect(markup).toContain("Doing");
    expect(markup).toContain("doing title");
    expect(markup).not.toContain("idea title");
    expect(markup).not.toContain("ready title");
    expect(markup).not.toContain("done title");
  });

  it("keeps the selected status empty instead of jumping to another status", () => {
    const markup = renderToStaticMarkup(createElement(MobileBoard, {
      objects: [object("idea", "idea")],
      activeStatus: "waiting",
      onStatusChange: vi.fn(),
      onSelect: vi.fn(),
      selectedId: null,
      minimizedIds: new Set<string>(),
      pendingIds: new Set<string>(),
      onToggleMinimize: vi.fn(),
      onCompleteNextAction: vi.fn(),
      onMoveStatus: vi.fn(),
    }));
    expect(markup).toContain("No Waiting objects");
    expect(markup).not.toContain("idea title");
  });

  it("exposes the shared status mutation entry point on mobile cards", () => {
    const markup = renderToStaticMarkup(createElement(ObjectCard, {
      object: object("doing", "doing"),
      minimized: false,
      pending: false,
      selected: false,
      dragEnabled: false,
      mobile: true,
      onSelect: vi.fn(),
      onToggleMinimize: vi.fn(),
      onCompleteNextAction: vi.fn(),
      onMoveStatus: vi.fn(),
    }));
    expect(markup).toContain('aria-label="Move doing title"');
    expect(markup).toContain("Move to");
  });
});