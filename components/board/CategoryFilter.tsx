"use client";

import { useEffect, useRef, useState } from "react";
import { colorStyle } from "@/lib/categories/colors";
import type { Category } from "@/lib/categories/model";
import type { CategoryFilterValue } from "@/lib/categories/filter";
import { categoryFilterLabel } from "@/lib/categories/filter";

export function CategoryFilter({ categories, value, onChange }: {
  categories: Category[];
  value: CategoryFilterValue;
  onChange: (value: CategoryFilterValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOnPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnKeyDown);
    };
  }, [open]);

  function toggleCategory(categoryId: string) {
    const selected = value.mode === "selected" ? value.categoryIds : [];
    const categoryIds = selected.includes(categoryId)
      ? selected.filter((id) => id !== categoryId)
      : [...selected, categoryId];
    onChange(categoryIds.length || (value.mode === "selected" && value.includeUncategorized)
      ? { mode: "selected", categoryIds, includeUncategorized: value.mode === "selected" && value.includeUncategorized }
      : { mode: "all" });
  }

  function toggleUncategorized() {
    const selected = value.mode === "selected" ? value : { mode: "selected" as const, categoryIds: [], includeUncategorized: false };
    const includeUncategorized = !selected.includeUncategorized;
    onChange(selected.categoryIds.length || includeUncategorized
      ? { mode: "selected", categoryIds: selected.categoryIds, includeUncategorized }
      : { mode: "all" });
  }

  const selectedIds = value.mode === "selected" ? value.categoryIds : [];
  const includeUncategorized = value.mode === "selected" && value.includeUncategorized;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="btn-secondary inline-flex items-center gap-2"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>Category: {categoryFilterLabel(value, categories)}</span>
        <span aria-hidden="true" className="text-slate-400">⌄</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Category filter" className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filter categories</p>
            <button type="button" className="text-xs font-medium text-blue-600 hover:text-blue-800" onClick={() => onChange({ mode: "all" })}>Clear / All</button>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {categories.map((category) => (
              <label key={category.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(category.id)}
                  onChange={() => toggleCategory(category.id)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorStyle(category.color).accent }} />
                <span className="min-w-0 flex-1 truncate">{category.name}</span>
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              <input type="checkbox" checked={includeUncategorized} onChange={toggleUncategorized} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-slate-300 bg-slate-100" />
              <span>No category</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}