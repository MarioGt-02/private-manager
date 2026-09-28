"use client";

import { colorStyle } from "@/lib/categories/colors";
import type { Category } from "@/lib/categories/model";
import type { CategoryFilterValue } from "@/lib/categories/filter";
import { applyQuickCategoryFilterClick } from "@/lib/categories/filter";

export function CategoryQuickFilterBar({ categories, value, onChange }: {
  categories: Category[];
  value: CategoryFilterValue;
  onChange: (value: CategoryFilterValue) => void;
}) {
  const selectedIds = value.mode === "selected" ? value.categoryIds : [];
  const includeUncategorized = value.mode === "selected" && value.includeUncategorized;
  function choose(categoryId: string | null, modified: boolean) {
    onChange(applyQuickCategoryFilterClick(value, categoryId, modified));
  }

  return (
    <nav aria-label="Quick category filter" className="quick-category-filter shrink-0 border-t border-slate-200 bg-white px-3 py-1.5 sm:px-5">
      <div className="grid w-full min-w-max overflow-x-auto" style={{ gridTemplateColumns: `repeat(${categories.length + 1}, minmax(0, 1fr))` }}>
        {categories.map((category) => {
          const active = selectedIds.includes(category.id);
          const palette = colorStyle(category.color);
          return <button key={category.id} type="button" aria-label={category.name} aria-pressed={active} onClick={(event) => choose(category.id, event.ctrlKey || event.metaKey)} className={`flex min-w-[8rem] items-center justify-center gap-1.5 border-r border-slate-200 px-2 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 sm:min-w-0 ${active ? "" : "bg-white text-slate-500 hover:bg-slate-50"}`} style={active ? { backgroundColor: palette.tint, color: palette.text, boxShadow: `inset 0 -3px 0 ${palette.accent}` } : undefined}>
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: palette.accent }} />
            <span className="truncate">{category.name}</span>
          </button>;
        })}
        <button type="button" aria-label="No category" aria-pressed={includeUncategorized} onClick={(event) => choose(null, event.ctrlKey || event.metaKey)} className={`flex min-w-[8rem] items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 sm:min-w-0 ${includeUncategorized ? "bg-slate-100 text-slate-800 shadow-[inset_0_-3px_0_#64748b]" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full border border-slate-400 bg-slate-100" />
          <span className="truncate">No category</span>
        </button>
      </div>
    </nav>
  );
}