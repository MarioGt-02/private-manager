import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TableGrid } from "@/components/tables/TableGrid";
import type { ObjectTableView } from "@/lib/tables/model";

const table: ObjectTableView = {
  id: "resize-table", objectId: "object", title: "Computer parts", position: 0,
  columns: [
    { id: "part", name: "Part", type: "text", currency: null, carryForward: false, position: 0 },
    { id: "notes", name: "Notes", type: "text", currency: null, carryForward: false, position: 1 },
    { id: "done", name: "Checked", type: "checkbox", currency: null, carryForward: false, position: 2 },
  ],
  rows: [{ id: "row", position: 0, carryForward: false, cells: { part: "RAM", notes: "Check contact and capacity", done: "false" } }],
};
const noop = () => {};
Object.assign(window, { resizeWrites: 0 });
function Harness() {
  const [current, setCurrent] = useState(table);
  const [open, setOpen] = useState(true);
  const [disabled, setDisabled] = useState(false);
  return <div className="mx-auto max-w-4xl p-4">
    <button onClick={() => setOpen((value) => !value)}>Toggle table</button>
    <button onClick={() => setCurrent((value) => ({ ...value, columns: [...value.columns].reverse() }))}>Reverse columns</button>
    <button onClick={() => setCurrent((value) => ({ ...value, id: value.id === table.id ? "second-table" : table.id }))}>Switch table</button>
    <button onClick={() => setDisabled((value) => !value)}>Read only</button>
    {open && <TableGrid table={current} disabled={disabled} recurring={false} onCells={(cells) => {
      (window as unknown as { resizeWrites: number }).resizeWrites++;
      setCurrent((value) => ({ ...value, rows: value.rows.map((row) => ({ ...row, cells: { ...row.cells, ...Object.fromEntries(cells.map((cell) => [cell.columnId, cell.value])) } })) }));
    }} onAddRow={noop} onAddColumn={noop} onDeleteRow={noop} onMoveRow={noop} onRowCarryForward={noop} onUpdateColumn={noop} onMoveColumn={noop} onDeleteColumn={noop} />}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Harness />);