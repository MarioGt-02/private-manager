import { z } from "zod";

export const COLOR_TOKENS = ["blue", "cyan", "teal", "green", "lime", "yellow", "amber", "orange", "red", "rose", "violet", "indigo", "slate", "brown"] as const;
export type CategoryColor = (typeof COLOR_TOKENS)[number];
export interface Category { id: string; name: string; color: CategoryColor; createdAt: string; }
export const categoryInputSchema = z.object({ name: z.string().trim().min(1).max(80), color: z.enum(COLOR_TOKENS) }).strict();
export const categoryAssignmentSchema = z.object({ objectId: z.string().min(1).max(200), categoryId: z.string().uuid().nullable() }).strict();
export const DEFAULT_CATEGORIES = [
  { id: "c9300000-0000-4000-8000-000000000001", name: "Tech & Software", color: "blue" },
  { id: "c9300000-0000-4000-8000-000000000002", name: "Maker & DIY", color: "orange" },
  { id: "c9300000-0000-4000-8000-000000000003", name: "Home & Life", color: "slate" },
  { id: "c9300000-0000-4000-8000-000000000004", name: "Vehicles", color: "amber" },
  { id: "c9300000-0000-4000-8000-000000000005", name: "Creative", color: "violet" },
  { id: "c9300000-0000-4000-8000-000000000006", name: "Health & Sport", color: "green" },
  { id: "c9300000-0000-4000-8000-000000000007", name: "Work & Business", color: "cyan" },
  { id: "c9300000-0000-4000-8000-000000000008", name: "Study & Learning", color: "indigo" },
] as const;
