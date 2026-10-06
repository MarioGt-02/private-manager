import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clampTableColumnWidth, parseTableColumnWidths } from "@/lib/tables/column-widths";
import { TableGrid } from "@/components/tables/TableGrid";

describe("Table column widths", () => {
  it("bounds widths while allowing narrow columns", () => {
    expect(clampTableColumnWidth(30)).toBe(56);
    expect(clampTableColumnWidth(92.7)).toBe(93);
    expect(clampTableColumnWidth(10000)).toBe(1600);
  });
  it("ignores invalid storage and removed columns, and maps by stable IDs", () => {
    for (const raw of [null, "broken", "null", "[]", '"value"']) expect(parseTableColumnWidths(raw, ["a"])).toEqual({});
    expect(parseTableColumnWidths('{"a":300,"b":1,"old":600,"c":"400","d":1e999}', ["b", "a", "c", "d"])).toEqual({ b: 56, a: 300 });
  });
  it("renders keyboard accessible resize handles even for read-only tables", () => {
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(TableGrid, { table: { id: "table", objectId: "object", title: "Parts", position: 0, columns: [{ id: "a", name: "Part", type: "text", currency: null, carryForward: false, position: 0 }], rows: [] }, disabled: true, recurring: false, onCells: noop, onAddRow: noop, onAddColumn: noop, onDeleteRow: noop, onMoveRow: noop, onRowCarryForward: noop, onUpdateColumn: noop, onMoveColumn: noop, onDeleteColumn: noop }));
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Resize column Part"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain("table-layout:fixed");
  });
});