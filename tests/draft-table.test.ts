import { describe, expect, it } from "vitest";
import { addColumn, changeColumnType, deleteColumn, moveColumn } from "@/lib/ai/draft-table";
import { formInputToDraftRecurrence, mergeChatDraft, recurrenceToFormInput } from "@/lib/ai/draft";
import type { DraftTable } from "@/lib/ai/types";

function table(): DraftTable {
  return {
    title: "Maintenance",
    columns: [
      { name: "A", type: "text", currency: null, carryForward: true },
      { name: "B", type: "number", currency: null, carryForward: false },
      { name: "C", type: "currency", currency: "EUR", carryForward: false },
    ],
    rows: [
      { carryForward: true, cells: ["a", "1", "10.00"] },
      { carryForward: false, cells: ["b", "2", "20.00"] },
    ],
  };
}

describe("Draft table alignment invariants", () => {
  it("moves a column and its cell in every row", () => {
    const moved = moveColumn(table(), 2, 0);
    expect(moved.columns.map((column) => column.name)).toEqual(["C", "A", "B"]);
    expect(moved.rows.map((row) => row.cells)).toEqual([["10.00", "a", "1"], ["20.00", "b", "2"]]);
  });

  it("deletes a column and its cell in every row", () => {
    const deleted = deleteColumn(table(), 1);
    expect(deleted.columns.map((column) => column.name)).toEqual(["A", "C"]);
    expect(deleted.rows.map((row) => row.cells)).toEqual([["a", "10.00"], ["b", "20.00"]]);
  });

  it("inserts a column with an empty cell in every row", () => {
    const added = addColumn(table(), { name: "D", type: "text", currency: null, carryForward: false }, 1);
    expect(added.columns.map((column) => column.name)).toEqual(["A", "D", "B", "C"]);
    expect(added.rows.map((row) => row.cells)).toEqual([["a", "", "1", "10.00"], ["b", "", "2", "20.00"]]);
  });

  it("no-ops on out-of-range moves without corrupting cells", () => {
    const unchanged = moveColumn(table(), 0, 5);
    expect(unchanged.rows.map((row) => row.cells)).toEqual([["a", "1", "10.00"], ["b", "2", "20.00"]]);
  });
});

describe("Lossless column type change", () => {
  const textColumn = (firstCells: string[]): DraftTable => ({
    ...table(),
    columns: table().columns.map((column, i) => (i === 0 ? { ...column, type: "text" as const } : column)),
    rows: table().rows.map((row, i) => ({ ...row, cells: [firstCells[i], row.cells[1], row.cells[2]] })),
  });

  it("normalises text '185' into currency without floating point", () => {
    const result = changeColumnType(textColumn(["185", "185"]), 0, "currency", "EUR");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.table.rows.map((row) => row.cells[0])).toEqual(["185.00", "185.00"]);
  });

  it("accepts text '185' as a number", () => {
    expect(changeColumnType(textColumn(["185", "185"]), 0, "number")).toMatchObject({ ok: true });
  });

  it("rejects '€185' → currency and keeps the original type and values", () => {
    const input = textColumn(["€185", "€185"]);
    const result = changeColumnType(input, 0, "currency", "EUR");
    expect(result.ok).toBe(false);
    expect(input.columns[0].type).toBe("text");
    expect(input.rows.map((row) => row.cells[0])).toEqual(["€185", "€185"]);
  });

  it("does not convert '2026 Chinese New Year' into an invented date", () => {
    expect(changeColumnType(textColumn(["2026 Chinese New Year", "2026 Chinese New Year"]), 0, "date")).toMatchObject({ ok: false });
  });

  it("refuses a checkbox conversion for non-boolean text", () => {
    expect(changeColumnType(textColumn(["yes", "no"]), 0, "checkbox")).toMatchObject({ ok: false });
  });
});

describe("Recurrence draft conversion", () => {
  it("completes a partial recurrence that has frequency and basis", () => {
    expect(recurrenceToFormInput({ frequency: "yearly", basis: "scheduled_date" })).toEqual({ frequency: "yearly", interval: 1, basis: "scheduled_date", nextDate: null });
  });

  it("returns null when basis or frequency is still unresolved", () => {
    expect(recurrenceToFormInput({ frequency: "yearly" })).toBeNull();
    expect(recurrenceToFormInput({ basis: "scheduled_date" })).toBeNull();
    expect(recurrenceToFormInput(null)).toBeNull();
  });

  it("round-trips a complete form input", () => {
    const input = { frequency: "yearly" as const, interval: 2, basis: "scheduled_date" as const, nextDate: "2027-03-31" };
    expect(recurrenceToFormInput(formInputToDraftRecurrence(input))).toEqual(input);
  });
});

describe("mergeChatDraft", () => {
  it("keeps the previous draft when the next response has none", () => {
    expect(mergeChatDraft({ title: "Keep me" }, null)).toEqual({ title: "Keep me" });
  });
  it("adopts the next draft when provided", () => {
    expect(mergeChatDraft({ title: "Old" }, { title: "New" })).toEqual({ title: "New" });
  });
});
