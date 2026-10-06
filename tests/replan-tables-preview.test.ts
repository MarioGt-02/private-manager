import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReplanDiff } from "@/components/ai/ObjectAI";
import type { ManagedObject } from "@/lib/types/object";

describe("Table-only Replan preview", () => {
  it("shows the actual table and confirmation notice, not fake checklist changes", () => {
    const object: ManagedObject = { id: "pc", title: "恢复旧电脑开机", goal: "稳定启动", status: "doing", position: 0, category: null, archivedAt: null, cancelledAt: null, currentState: "尚未确认故障原因", nextAction: "尝试断电后重新启动", checklist: [], unresolvedDependencies: 0, recurrence: null, occurrenceNote: null };
    const proposal = { title: null, goal: null, currentState: object.currentState, reasonSummary: "Proposed inspection table", checklistMode: "preserve" as const, checklist: [], removedItemIds: [], summary: "Awaiting confirmation", tablesToAdd: [{ title: "电脑部件检查表格", columns: [{ name: "部件", type: "text" as const, currency: null, carryForward: false }, { name: "已检查", type: "checkbox" as const, currency: null, carryForward: false }], rows: [{ carryForward: false, cells: ["内存", "false"] }] }] };
    const html = renderToStaticMarkup(createElement(ReplanDiff, { object, proposal }));
    for (const text of ["Only adds tables", "remain unchanged", "saved only after you apply", "New tables", "电脑部件检查表格", "部件", "内存"]) expect(html).toContain(text);
    for (const text of ["Checklist changes", "Final checklist", "Before:", "使用电脑部件检查表格完成部件检查"]) expect(html).not.toContain(text);
  });
});