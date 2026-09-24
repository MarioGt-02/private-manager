import type { CategoryColor } from "./model";
export const CATEGORY_COLORS: Record<CategoryColor, { accent: string; tint: string; text: string }> = {
  blue: { accent: "#2563eb", tint: "#eff6ff", text: "#1e40af" },
  cyan: { accent: "#0891b2", tint: "#ecfeff", text: "#155e75" },
  teal: { accent: "#0d9488", tint: "#f0fdfa", text: "#115e59" },
  green: { accent: "#16a34a", tint: "#f0fdf4", text: "#166534" },
  lime: { accent: "#65a30d", tint: "#f7fee7", text: "#3f6212" },
  yellow: { accent: "#eab308", tint: "#fefce8", text: "#854d0e" },
  amber: { accent: "#d97706", tint: "#fffbeb", text: "#92400e" },
  orange: { accent: "#ea580c", tint: "#fff7ed", text: "#9a3412" },
  red: { accent: "#dc2626", tint: "#fef2f2", text: "#991b1b" },
  rose: { accent: "#e11d48", tint: "#fff1f2", text: "#9f1239" },
  violet: { accent: "#7c3aed", tint: "#f5f3ff", text: "#5b21b6" },
  indigo: { accent: "#4f46e5", tint: "#eef2ff", text: "#3730a3" },
  slate: { accent: "#64748b", tint: "#f8fafc", text: "#334155" },
  brown: { accent: "#946747", tint: "#faf5f0", text: "#69452c" },
};
export function colorStyle(color?: string | null) {
  return color && Object.hasOwn(CATEGORY_COLORS, color) ? CATEGORY_COLORS[color as CategoryColor] : CATEGORY_COLORS.slate;
}
