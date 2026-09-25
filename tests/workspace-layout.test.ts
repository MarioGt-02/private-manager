import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The Board graph reaches server-only modules through its server actions; the
// repo mocks them in tests (see tests/dependencies.test.ts).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/object-actions", () => ({
  createManualObjectAction: vi.fn(),
  moveObjectToStatus: vi.fn(),
  reorderObjectsAction: vi.fn(),
  setChecklistItemCompleted: vi.fn(),
  updateObjectFieldsAction: vi.fn(),
  addChecklistItemAction: vi.fn(),
  renameChecklistItemAction: vi.fn(),
  deleteChecklistItemAction: vi.fn(),
  reorderChecklistItemsAction: vi.fn(),
  updateObjectRecurrenceAction: vi.fn(),
  updateOccurrenceNoteAction: vi.fn(),
}));

import { ObjectDrawer } from "@/components/board/ObjectDrawer";
import { Board } from "@/components/board/Board";
import { TableGrid } from "@/components/tables/TableGrid";
import { ColumnMenuPanel } from "@/components/tables/ColumnMenu";
import type { ManagedObject } from "@/lib/types/object";
import type { ObjectTableView } from "@/lib/tables/model";

const noop = () => {};
const asyncNoop = async () => {};

/** The manual acceptance case: a recurring Audi maintenance Object. */
const object: ManagedObject = {
  id: "object-uuid",
  title: "Audi A3 定期保养 — 2026",
  status: "doing",
  position: 0,
  category: "Vehicles",
  categoryId: null,
  archivedAt: null,
  cancelledAt: null,
  goal: "Keep the car serviced",
  currentState: "Planning",
  nextAction: "Record mileage",
  occurrenceNote: "Filter bought already",
  unresolvedDependencies: 0,
  recurrence: { seriesId: "object-uuid", frequency: "yearly", interval: 1, basis: "scheduled_date", nextDate: "2026-01-01", previousOccurrenceId: null, nextOccurrenceId: null },
  checklist: [
    { id: "item-1", title: "Record mileage", completed: true, position: 0, parentId: null },
    { id: "item-2", title: "Buy required materials", completed: false, position: 1, parentId: null },
  ],
};

const drawerProps = {
  object,
  activityVersion: 0,
  onClose: noop,
  onToggleChecklist: asyncNoop,
  onEditField: asyncNoop,
  onAddChecklist: asyncNoop,
  onRenameChecklist: asyncNoop,
  onDeleteChecklist: asyncNoop,
  onReorderChecklist: asyncNoop,
  onApplyProgress: asyncNoop,
  onApplyReplan: asyncNoop,
  onLifecycle: asyncNoop,
  onCategoryChange: asyncNoop,
  onDeleteObject: asyncNoop,
  onOpenObject: noop,
  onUpdateRecurrence: asyncNoop,
  onUpdateNote: asyncNoop,
  onRefreshActivity: noop,
};

const drawerMarkup = () => renderToStaticMarkup(createElement(ObjectDrawer, drawerProps));

const table: ObjectTableView = {
  id: "table-uuid",
  objectId: "object-uuid",
  title: "保养项目",
  position: 0,
  columns: [
    { id: "c1", name: "保养项目", type: "text", currency: null, position: 0, carryForward: true },
    { id: "c2", name: "本次处理", type: "checkbox", currency: null, position: 1, carryForward: false },
    { id: "c3", name: "费用", type: "currency", currency: "EUR", position: 2, carryForward: false },
  ],
  rows: [{ id: "r1", position: 0, carryForward: true, cells: { c1: "Engine oil", c2: "false", c3: "55.00" } }],
};

const gridProps = {
  table,
  disabled: false,
  recurring: true,
  onCells: noop,
  onAddRow: noop,
  onAddColumn: noop,
  onDeleteRow: noop,
  onMoveRow: noop,
  onRowCarryForward: noop,
  onUpdateColumn: noop,
  onMoveColumn: noop,
  onDeleteColumn: noop,
};

describe("Object Workspace layout", () => {
  it("renders as a wide workspace dialog", () => {
    const markup = drawerMarkup();
    expect(markup).toContain('class="workspace-dialog"');
    expect(markup).toContain('data-size="workspace"');
    expect(markup).toContain('aria-label="Object details"');
  });

  it("renders the persistent header with title, status, category and actions", () => {
    const markup = drawerMarkup();
    for (const text of ["Object workspace", "Object actions"]) expect(markup).toContain(text);
    expect(markup).toContain("Audi A3 定期保养 — 2026");
    expect(markup).toContain("Doing");
    expect(markup).toContain('aria-label="Archive Object"');
    expect(markup).toContain('aria-label="Delete Object"');
    expect(markup).toContain('aria-label="Close Object Drawer"');
  });

  it("keeps every existing Object field in the main content", () => {
    const markup = drawerMarkup();
    for (const text of ["Goal", "Current State", "Next Action", "Occurrence note"]) expect(markup).toContain(text);
    expect(markup).toContain("Keep the car serviced");
    expect(markup).toContain("Record mileage");
    expect(markup).toContain("Filter bought already");
  });

  it("keeps the Checklist with its progress counter", () => {
    const markup = drawerMarkup();
    expect(markup).toContain('aria-label="Checklist"');
    expect(markup).toContain("Buy required materials");
    expect(markup).toContain("1 / 2");
  });

  it("keeps Tables, Dependencies and Recurring in the content column", () => {
    const markup = drawerMarkup();
    expect(markup).toContain("Tables / Records");
    expect(markup).toContain("Loading tables…");
    expect(markup).toContain("Dependencies");
    expect(markup).toContain('aria-label="Recurring"');
    expect(markup).toContain("Every 1 year");
  });
});

describe("Object Workspace sidebar and scrolling", () => {
  it("moves Activity into the dedicated sidebar and never duplicates it", () => {
    const markup = drawerMarkup();
    expect(markup).toContain("<aside");
    // Exactly one Activity region, placed after the content column.
    expect(markup.split('aria-label="Activity"').length - 1).toBe(1);
    expect(markup.indexOf('aria-label="Object content"')).toBeLessThan(markup.indexOf("<aside"));
    // The content column never repeats the history.
    const [content] = markup.split("<aside");
    expect(content).not.toContain('aria-label="Activity"');
  });

  it("renders Activity for any activity version, so refreshes keep working", () => {
    for (const activityVersion of [0, 3]) {
      const markup = renderToStaticMarkup(createElement(ObjectDrawer, { ...drawerProps, activityVersion }));
      expect(markup).toContain('aria-label="Activity"');
      expect(markup).toContain("Loading activity…");
    }
  });

  it("uses a desktop-only two-column grid and stacks content before activity below lg", () => {
    const markup = drawerMarkup();
    const beforeContent = markup.slice(0, markup.indexOf('aria-label="Object content"'));
    const bodyTag = beforeContent.slice(beforeContent.lastIndexOf("<div"));
    const classes = /class="([^"]*)"/.exec(bodyTag)![1].split(" ");
    // The two-column layout only starts at the lg breakpoint.
    expect(classes).toContain("lg:grid");
    expect(classes).not.toContain("grid");
    expect(classes).toContain("lg:grid-cols-[minmax(0,1fr)_250px]");
    expect(classes).toContain("xl:grid-cols-[minmax(0,1fr)_280px]");
    // Desktop: the body is fixed height and each column scrolls. Below lg: one scroll.
    expect(classes).toContain("overflow-y-auto");
    expect(classes).toContain("lg:overflow-hidden");
    // Mobile keeps a visible separator above the sidebar instead of a border-left.
    expect(markup).toContain("lg:border-l");
  });

  it("never makes the workspace scroll horizontally", () => {
    const markup = drawerMarkup();
    expect(markup).not.toContain("overflow-x-auto");
    expect(markup).not.toContain("overflow-x-scroll");
  });
});

describe("Object Workspace table presentation", () => {
  it("fills the available width and only scrolls when the column minimums cannot fit", () => {
    const markup = renderToStaticMarkup(createElement(TableGrid, gridProps));
    expect(markup).toContain("overflow-x-auto");
    // The table prefers 100% width instead of a fixed minimum.
    expect(markup).toContain('class="w-full border-collapse text-sm"');
    expect(markup).not.toContain("min-w-[560px]");
    // Per-type minimums decide when horizontal scrolling becomes necessary.
    expect(markup).toContain("min-w-[9rem]");   // text
    expect(markup).toContain("min-w-[7rem]");   // currency
    expect(markup).toContain("min-w-[4rem]");   // checkbox
    expect(markup).toContain("min-w-[5.5rem]"); // row actions
    // Only the grid viewport scrolls horizontally; the workspace never does.
    expect(markup.split("overflow-x-auto").length - 1).toBe(1);
  });

  it("keeps the type label in the column menu, not in the table header", () => {
    const markup = renderToStaticMarkup(createElement(TableGrid, gridProps));
    const head = markup.slice(markup.indexOf("<thead"), markup.indexOf("</thead>"));
    // Column headers no longer carry a permanent TEXT / CHECKBOX / CURRENCY label.
    for (const label of ["Text", "Checkbox", "Currency"]) expect(head).not.toContain(label);
    // The compact repeat marker stays, because it is not a type label.
    expect(head).toContain("↻");
    // The type is available where the column is configured.
    const panel = renderToStaticMarkup(createElement(ColumnMenuPanel, {
      column: table.columns[2], index: 2, count: 3, disabled: false, recurring: true,
      onUpdate: noop, onMove: noop, onDelete: noop, onClose: noop,
    }));
    expect(panel).toContain("费用");
    expect(panel).toContain("Currency");
    expect(panel).toContain("EUR");
  });

  it("keeps the column menu out of table layout entirely", () => {
    const markup = renderToStaticMarkup(createElement(TableGrid, gridProps));
    const head = markup.slice(markup.indexOf("<thead"), markup.indexOf("</thead>"));
    // No editable controls sit in the header row any more, so the menu cannot
    // expand the header when it opens.
    expect(head).not.toContain("<input");
    expect(head).not.toContain("<select");
    expect(head).not.toContain("<details");
    // The trigger stays a real button with an accessible label.
    expect(head).toContain('aria-haspopup="dialog"');
    expect(head).toContain('aria-expanded="false"');
    expect(head).toContain('aria-label="Column options: 保养项目"');
  });

  it("keeps the compact row repeat control discoverable for recurring Objects", () => {
    const markup = renderToStaticMarkup(createElement(TableGrid, gridProps));
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('title="Repeat this row in the next occurrence"');
    expect(markup).toContain('aria-label="Repeat this row in the next occurrence: row 1"');
    // The control explains itself in text, not only through the icon.
    expect(markup).toContain("↻");
  });
});

describe("Board regression", () => {
  it("still renders the board with its columns and Object card", () => {
    const markup = renderToStaticMarkup(createElement(Board, { initialObjects: [object] }));
    for (const label of ["Private Manager", "Idea", "Ready", "Doing", "Waiting", "Done"]) expect(markup).toContain(label);
    expect(markup).toContain("Audi A3 定期保养 — 2026");
  });
});
