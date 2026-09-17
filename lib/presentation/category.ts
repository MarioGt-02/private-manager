/** Restrained versions of the user's legacy category colors. Values stay source-authentic;
 * only palette lookup is case-insensitive. No user-supplied CSS is rendered. */
const palette: Record<string, { accent: string; tint: string }> = {
  informatica: { accent: "#0891b2", tint: "#ecfeff" },
  macchina: { accent: "#ca8a04", tint: "#fefce8" },
  legname: { accent: "#946747", tint: "#faf5f0" },
  sport: { accent: "#374a78", tint: "#eef2ff" },
  elettrico: { accent: "#ea7517", tint: "#fff7ed" },
  casa: { accent: "#64748b", tint: "#f1f5f9" },
  fotografia: { accent: "#2563eb", tint: "#eff6ff" },
  cucina: { accent: "#d96548", tint: "#fff1ed" },
  "stampante 3d": { accent: "#b83298", tint: "#fdf4ff" },
  gamemake: { accent: "#7c5bbe", tint: "#f5f3ff" },
  musica: { accent: "#28744b", tint: "#f0fdf4" },
  cucire: { accent: "#379878", tint: "#ecfdf5" },
  busnis: { accent: "#3893b9", tint: "#f0f9ff" },
  business: { accent: "#3893b9", tint: "#f0f9ff" },
  disegno: { accent: "#ab8b50", tint: "#faf7ee" },
  "lavoro urgente": { accent: "#c34a53", tint: "#fff1f2" },
};
const neutral = { accent: "#94a3b8", tint: "#f8fafc" };
export function categoryStyle(category?: string | null) {
  const key = category?.trim().toLowerCase() ?? "";
  return Object.hasOwn(palette, key) ? palette[key] : neutral;
}
/** Remove only the known import banner from the Board preview; never alter stored data. */
export function currentStatePreview(value: string): string {
  const banner = "Imported from Kanban Tool.";
  const trimmed = value.trim();
  if (trimmed.startsWith(banner)) return trimmed.slice(banner.length).trim() || "Imported historical Object.";
  return trimmed;
}
