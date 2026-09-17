"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Category } from "@/lib/categories/model";

export const CategoryContext = createContext<{ categories: Category[]; error: string; loading: boolean; reload: () => void; saved: (category: Category) => void }>({ categories: [], error: "", loading: false, reload: () => {}, saved: () => {} });
export function CategoryProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/categories", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.categories)) throw new Error();
      setCategories(data.categories); setError(""); setLoading(false);
    }).catch(() => { if (!controller.signal.aborted) { setError("Could not load categories."); setLoading(false); } });
    return () => controller.abort();
  }, [version]);
  return <CategoryContext.Provider value={{ categories, error, loading, reload: () => { setLoading(true); setVersion((value) => value + 1); }, saved: (category) => setCategories((items) => [...items.filter((item) => item.id !== category.id), category].sort((a, b) => a.name.localeCompare(b.name))) }}>{children}</CategoryContext.Provider>;
}
export function useObjectCategory(object: { categoryId?: string | null }) {
  return useContext(CategoryContext).categories.find((category) => category.id === object.categoryId) ?? null;
}
export async function mutateCategory(body: unknown) {
  const response = await fetch("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("Could not save category. Check the name and try again.");
  return response.json();
}
