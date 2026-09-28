"use client";

import { colorStyle } from "@/lib/categories/colors";
import type { Category } from "@/lib/categories/model";
import type { CategoryFilterValue } from "@/lib/categories/filter";

export function CategoryQuickFilterBar({ categories, value, onChange }: {
  categories: Category[];
  value: CategoryFilterValue;
  onChange: (value: CategoryFilterValue) => void;
}) {
  const selectedIds = value.mode === "selected" ? value.categoryIds : [];
  const includeUncategorized = value.mode === "selected" && value.includeUncategorized;
  const allActive = value.mode === "all";

  function chooseCategory(categoryId: string) {
    onChange(selectedIds.length === 1 && selectedIds[0] === categoryId && !includeUncategorized
      ? { mode: "all" }
      : { mode: "selected", categoryIds: [categoryId], includeUncategorized: false });
  }

  function chooseUncategorized() {
    onChange(includeUncategorized && selectedIds.length === 0
      ? { mode: "all" }
      : { mode: "selected", categoryIds: [], includeUncategorized: true });
  }

  return (
    <nav aria-label="Quick category filter" className="shrink-0 border-t border-slate-200 bg-white px-3 py-2 sm:px-5">
      <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5">
        <button type="button" aria-pressed={allActive} onClick={() => onChange({ mode: "all" })} className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 ${allActive ? "border-slate-500 bg-slate-700 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>All</button>
        {categories.map((category) => {
          const active = selectedIds.includes(category.id);
          const palette = colorStyle(category.color);
          return <button key={category.id} type="button" aria-label={category.name} aria-pressed={active} onClick={() => chooseCategory(category.id)} className={`flex max-w-48 shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 ${active ? "text-slate-900 shadow-sm" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`} style={active ? { borderColor: palette.accent, backgroundColor: palette.tint, color: palette.text } : undefined}>
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: palette.accent }} />
            <span className="truncate">{category.name}</span>
          </button>;
        })}
        <button type="button" aria-label="No category" aria-pressed={includeUncategorized} onClick={chooseUncategorized} className={`flex max-w-40 shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 ${includeUncategorized ? "border-slate-500 bg-slate-700 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full border border-slate-400 bg-slate-100" />
          <span className="truncate">No category</span>
        </button>
      </div>
    </nav>
  );
}