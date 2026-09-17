export interface CategoryOption { id: string; name: string }

/** Exact name matching after trimming/case folding; never fuzzy or generative. */
export function resolveCategorySuggestion(name: string | null, categories: CategoryOption[]): CategoryOption | null {
  if (name === null) return null;
  const normalized = name.trim().toLowerCase();
  const matches = categories.filter((category) => category.name.trim().toLowerCase() === normalized);
  return matches.length === 1 ? matches[0] : null;
}

export class InvalidCategoryError extends Error {
  constructor() { super("The selected category no longer exists. Choose another category or No category."); }
}
