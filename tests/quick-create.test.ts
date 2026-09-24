import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";
import { normalizeLegacyDraft, quickCreateRequestSchema, quickCreateResponseSchema } from "@/lib/ai/schemas";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), ai: vi.fn(), response: vi.fn() }));
vi.mock("@/lib/db/index", () => ({ getDb: () => { mocks.db(); return db; } }));
vi.mock("@/lib/auth/require-auth", () => ({ requireAuth: mocks.auth, UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: mocks.ai }));
import { POST as quick } from "@/app/api/ai/create-object/quick/route";
import { getCategoryOptions } from "@/lib/db/categories";

const request = (body: unknown) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
const output = (draft: unknown) => ({ output_text: JSON.stringify(draft) });
const validDraft = { title: "Buy BMW G310 R", goal: "Purchase a used G310 R within budget", currentState: "Budget around €3000, no license yet", nextAction: "Research listings", suggestedCategoryName: "Vehicles", checklist: [{ title: "Research listings" }, { title: "Compare motorcycles" }, { title: "Estimate insurance cost" }] };

beforeAll(async () => {
  pg = new PGlite(); db = drizzle(pg, { schema });
  for (const file of ["0000_flaky_meggan", "0001_object_archive_metadata", "0002_object_category_presentation", "0003_silent_groot", "0004_keen_diamondback", "0005_boring_quicksilver", "0006_faulty_meteorite", "0007_clever_annihilus","0008_silky_slapstick","0009_loose_skin"]) await pg.exec(await readFile(`drizzle/${file}.sql`, "utf8"));
}, 30000);

beforeEach(async () => {
  await pg.exec("TRUNCATE objects CASCADE");
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  mocks.auth.mockResolvedValue({});
  mocks.ai.mockReturnValue({ responses: { create: mocks.response } });
  mocks.response.mockResolvedValue(output(validDraft));
});

afterAll(async () => { vi.unstubAllEnvs(); await pg.close(); });

describe("Quick Create schemas", () => {
  it("rejects empty text and accepts long multiline text", () => {
    expect(quickCreateRequestSchema.safeParse({ text: "" }).success).toBe(false);
    expect(quickCreateRequestSchema.safeParse({ text: "a\nb\nc" }).success).toBe(true);
    expect(quickCreateRequestSchema.safeParse({ text: "买车，预算三千" }).success).toBe(true);
  });

  it("validates the draft structure (flat and hierarchical checklist)", () => {
    expect(quickCreateResponseSchema.safeParse(validDraft).success).toBe(true);
    expect(quickCreateResponseSchema.safeParse({ ...validDraft, checklist: [{ title: "P", children: [{ title: "C" }] }] }).success).toBe(true);
    expect(quickCreateResponseSchema.safeParse({ ...validDraft, checklist: [] }).success).toBe(true); // empty checklist is schema-valid; finalize rejects it
    expect(quickCreateResponseSchema.safeParse({ title: "only" }).success).toBe(false);
  });

  it("normalizes legacy string checklist items and string children", () => {
    const normalized = normalizeLegacyDraft({ ...validDraft, checklist: [{ title: "P", children: ["c1", "c2"] }] });
    const result = quickCreateResponseSchema.safeParse(normalized);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.checklist[0].children).toEqual([{ title: "c1", completed: false }, { title: "c2", completed: false }]);
  });
});

describe("Quick Create endpoint", () => {
  it("generates a draft without persisting an Object", async () => {
    const response = await quick(request({ text: "Buy a used BMW G310R" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.draft.title).toBe("Buy BMW G310 R");
    expect(data.draft.categoryId).toBe(resolveVehiclesId(await getCategoryOptions()));
    expect(data.draft).not.toHaveProperty("suggestedCategoryName");
    expect(data.categories).toEqual(await getCategoryOptions());
    expect(mocks.response).toHaveBeenCalledTimes(1);
    expect(await db.select().from(schema.objects)).toHaveLength(0);
  });

  it("rejects empty input without calling AI", async () => {
    const response = await quick(request({ text: "   " }));
    expect(response.status).toBe(400);
    expect(mocks.response).not.toHaveBeenCalled();
  });

  it("rejects non-JSON AI output safely", async () => {
    mocks.response.mockResolvedValueOnce({ output_text: "not json" });
    const response = await quick(request({ text: "text" }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await db.select().from(schema.objects)).toHaveLength(0);
  });

  it("rejects schema-invalid AI output safely", async () => {
    mocks.response.mockResolvedValueOnce(output({ title: "missing fields" }));
    const response = await quick(request({ text: "text" }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json();
    expect(body.error.code).toBe("AI_SCHEMA_VALIDATION_ERROR");
  });
});

function resolveVehiclesId(categories: { id: string; name: string }[]) {
  return categories.find((c) => c.name === "Vehicles")?.id ?? null;
}
