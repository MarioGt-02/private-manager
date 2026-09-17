import { DEFAULT_CATEGORIES } from "./model";
// Only preserved source categories are classified, never titles or free text.
const groups = [
  ["informatica", "gamemake"],
  ["elettrico", "legname", "stampante 3d", "3d modeling", "cucire"],
  ["casa", "cucina"], ["macchina"], ["fotografia", "disegno", "musica"], ["sport"], ["busnis"], [],
];
export function mapLegacyCategory(value: string | null) {
  const index = groups.findIndex((values) => values.includes(value?.trim().toLowerCase() ?? ""));
  return index < 0 ? null : DEFAULT_CATEGORIES[index];
}
