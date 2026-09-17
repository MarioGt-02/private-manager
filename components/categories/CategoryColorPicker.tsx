"use client";
import { COLOR_TOKENS, type CategoryColor } from "@/lib/categories/model";
import { colorStyle } from "@/lib/categories/colors";
export function CategoryColorPicker({ value, onChange, disabled }: { value: CategoryColor; onChange: (value: CategoryColor) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled}><legend className="section-label mb-2">Color</legend><div className="flex max-w-72 flex-wrap gap-2">
    {COLOR_TOKENS.map((color) => <button key={color} type="button" aria-label={color} title={color} aria-pressed={value === color} onClick={() => onChange(color)} className={`h-8 w-8 rounded-full border-2 text-white ${value === color ? "ring-2 ring-slate-800 ring-offset-2" : "border-transparent"}`} style={{ backgroundColor: colorStyle(color).accent }}>{value === color ? <span aria-hidden="true">✓</span> : null}</button>)}
  </div></fieldset>;
}
