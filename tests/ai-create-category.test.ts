import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { resolveCategorySuggestion } from "@/lib/categories/suggestion";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), ai: vi.fn(), response: vi.fn() }));
vi.mock("@/lib/db/index", () => ({ getDb: () => { mocks.db(); return db; } }));
vi.mock("@/lib/auth/require-auth", () => ({ requireAuth: mocks.auth, UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: mocks.ai }));
import { UnauthorizedError } from "@/lib/auth/require-auth";
import { POST as chat } from "@/app/api/ai/create-object/chat/route";
import { POST as finalize } from "@/app/api/ai/create-object/finalize/route";
import { POST as progress } from "@/app/api/ai/objects/[objectId]/progress/apply/route";
import { POST as replan } from "@/app/api/ai/objects/[objectId]/replan/apply/route";
import { getCategoryOptions } from "@/lib/db/categories";
import { getObject } from "@/lib/db/queries";

const draft = { title: "Make a desk", goal: "Build a desk", currentState: "Wood purchased", nextAction: "AI text is overridden by checklist", checklist: [{ title: "Buy wood", completed: true, position: 0 }, { title: "Cut legs", completed: false, position: 1 }] };
const request = (body: unknown) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
const analyze = () => chat(request({ messages: [{ role: "user", content: "Make a desk" }] }));
const confirm = (categoryId: string | null) => finalize(request({ draft: { ...draft, categoryId } }));
const output = (suggestedCategoryName: string | null) => ({ output_text: JSON.stringify({ message: "Review this proposal.", phase: "proposal", draft: { ...draft, suggestedCategoryName } }) });

beforeAll(async () => {
  pg = new PGlite(); db = drizzle(pg, { schema });
  for (const file of ["0000_flaky_meggan", "0001_object_archive_metadata", "0002_object_category_presentation", "0003_silent_groot", "0004_keen_diamondback", "0005_boring_quicksilver"]) await pg.exec(await readFile(`drizzle/${file}.sql`, "utf8"));
}, 30000);
beforeEach(async () => {
  await pg.exec("TRUNCATE objects CASCADE");
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-not-a-real-key");
  mocks.auth.mockResolvedValue({});
  mocks.ai.mockReturnValue({ responses: { create: mocks.response } });
  mocks.response.mockResolvedValue(output("Maker & DIY"));
});
afterAll(async () => { vi.unstubAllEnvs(); await pg.close(); });

describe("AI Create category suggestion", () => {
  it("does not infer fuzzy matches or resolve ambiguous normalized names", () => {
    expect(resolveCategorySuggestion("Vehicles", [])).toBeNull();
    expect(resolveCategorySuggestion("Vehicle", [{ id: "a", name: "Vehicles" }])).toBeNull();
    expect(resolveCategorySuggestion("Vehicles", [{ id: "a", name: "Vehicles" }, { id: "b", name: " vehicles " }])).toBeNull();
  });

  it.each(["Maker & DIY", "  maker & diy  ", null, "Invented category"])("resolves %s safely with exactly one model request and no writes", async (name) => {
    const categories = await getCategoryOptions();
    mocks.response.mockResolvedValueOnce(output(name));
    const response = await analyze();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.draft.categoryId).toBe(resolveCategorySuggestion(name, categories)?.id ?? null);
    expect(data.draft).not.toHaveProperty("suggestedCategoryName");
    expect(data.categories).toEqual(categories);
    expect(mocks.response).toHaveBeenCalledTimes(1);
    expect(await db.select().from(schema.objects)).toHaveLength(0);
    expect(await db.select().from(schema.objectUpdates)).toHaveLength(0);
    expect(await getCategoryOptions()).toEqual(categories);
  });

  it("reads custom/renamed categories fresh and sends only category names, including edited draft context", async () => {
    await db.insert(schema.categories).values({ id: "private-custom-id", name: "Personal Research", color: "blue" });
    try {
      mocks.response.mockResolvedValueOnce(output("Personal Research"));
      const response = await chat(request({ messages: [{ role: "user", content: "Review this" }], currentDraft: { ...draft, categoryId: "private-custom-id" } }));
      expect((await response.json()).draft.categoryId).toBe("private-custom-id");
      const sent = mocks.response.mock.calls[0][0];
      expect(JSON.stringify(sent.input)).toContain("Personal Research");
      expect(JSON.stringify(sent.input)).not.toContain("private-custom-id");
      expect(JSON.stringify(sent.input)).not.toContain("createdAt");
      expect(JSON.stringify(sent.input)).not.toContain('"color"');
      expect(JSON.stringify(sent.text.format)).toContain("suggestedCategoryName");
      expect(JSON.stringify(sent.text.format)).not.toContain("categoryId");
      await db.update(schema.categories).set({ name: "Renamed Research" }).where(eq(schema.categories.id, "private-custom-id"));
      mocks.response.mockResolvedValueOnce(output("Personal Research"));
      expect((await (await analyze()).json()).draft.categoryId).toBeNull();
    } finally { await db.delete(schema.categories).where(eq(schema.categories.id, "private-custom-id")); }
  });

  it("keeps clarification independent of category assignment", async () => {
    mocks.response.mockResolvedValueOnce({ output_text: JSON.stringify({ message: "What outcome do you want?", phase: "clarifying", draft: null }) });
    expect((await (await analyze()).json()).draft).toBeNull();
    expect(mocks.response).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated chat and finalize before DB or AI work", async () => {
    mocks.auth.mockRejectedValue(new UnauthorizedError());
    expect((await analyze()).status).toBe(401);
    expect((await confirm(null)).status).toBe(401);
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.ai).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue({});
  });

  it("preserves rate limit handling without an extra model call", async () => {
    mocks.response.mockRejectedValueOnce({ status: 429 });
    expect((await analyze()).status).toBe(429);
    expect(mocks.response).toHaveBeenCalledTimes(1);
  });
});

describe("User-confirmed category persistence", () => {
  it.each([true, false])("persists the final selection (selected=%s) in the original creation transaction", async (selected) => {
    const categories = await getCategoryOptions();
    const suggestion = await (await analyze()).json();
    const categoryId = selected ? categories.find((category) => category.name === "Vehicles")!.id : null;
    const response = await finalize(request({ draft: { ...suggestion.draft, categoryId } }));
    expect(response.status).toBe(200);
    const { object } = await response.json();
    expect(await getObject(object.id)).toMatchObject({ categoryId, status: "idea", nextAction: "Cut legs", checklist: [{ title: "Buy wood", completed: true, position: 0 }, { title: "Cut legs", completed: false, position: 1 }] });
    const events = await db.select().from(schema.objectUpdates);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "object_created", content: "Object created with AI assistance." });
    expect(mocks.response).toHaveBeenCalledTimes(1); // finalize adds zero calls
  });

  it("rejects nonexistent category IDs without partial writes", async () => {
    const response = await confirm("missing");
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("no longer exists");
    expect(await db.select().from(schema.objects)).toHaveLength(0);
    expect(await db.select().from(schema.checklistItems)).toHaveLength(0);
    expect(await db.select().from(schema.objectUpdates)).toHaveLength(0);
    expect(mocks.ai).not.toHaveBeenCalled();
  });

  it("rejects a category deleted after drafting, including replacement with the same name", async () => {
    await db.insert(schema.categories).values({ id: "removed-category", name: "Temporary domain", color: "blue" });
    mocks.response.mockResolvedValueOnce(output("Temporary domain"));
    const suggestion = await (await analyze()).json();
    await db.delete(schema.categories).where(eq(schema.categories.id, "removed-category"));
    await db.insert(schema.categories).values({ id: "replacement-category", name: "Temporary domain", color: "blue" });
    try {
      expect((await finalize(request({ draft: suggestion.draft }))).status).toBe(400);
      expect(await db.select().from(schema.objects)).toHaveLength(0);
    } finally { await db.delete(schema.categories).where(eq(schema.categories.id, "replacement-category")); }
  });

  it("rolls back the categorized Object and checklist when Activity cannot be written", async () => {
    const [category] = await getCategoryOptions();
    await pg.exec("ALTER TABLE object_updates ADD CONSTRAINT fail_creation CHECK(type <> 'object_created')");
    try {
      expect((await confirm(category.id)).status).toBe(500);
      expect(await db.select().from(schema.objects)).toHaveLength(0);
      expect(await db.select().from(schema.checklistItems)).toHaveLength(0);
    } finally { await pg.exec("ALTER TABLE object_updates DROP CONSTRAINT fail_creation"); }
  });

  it("Progress and Replan ignore attempted category changes", async () => {
    const [category, other] = await getCategoryOptions();
    const { object } = await (await confirm(category.id)).json();
    const context = { params: Promise.resolve({ objectId: object.id }) };
    const result = await progress(request({ update: { categoryId: other.id, currentState: "Legs cut", nextAction: "Assemble", completedItemIds: [object.checklist[1].id], reopenedItemIds: [], newChecklistItems: [], summary: "Cut legs" } }), context);
    expect(result.status).toBe(200);
    expect((await getObject(object.id))?.categoryId).toBe(category.id);
    const updated = (await getObject(object.id))!;
    const replanned = await replan(request({ proposal: { categoryId: null, title: null, goal: null, currentState: "Legs cut", reasonSummary: "Keep plan", checklist: updated.checklist.map((item) => ({ sourceItemId: item.id, title: item.title, completed: item.completed, position: item.position, changeType: "keep" })), removedItemIds: [], summary: "Kept plan" } }), context);
    expect(replanned.status).toBe(200);
    expect((await getObject(object.id))?.categoryId).toBe(category.id);
    expect(mocks.ai).not.toHaveBeenCalled();
  });
});

// Explicit opt-in: five real reasoning calls; persistence stays in disposable PGlite.
it.skipIf(process.env.RUN_AI_CATEGORY_LIVE !== "1")("live acceptance of the five requested category examples", async () => {
  vi.unstubAllEnvs();
  if (!process.env.OPENAI_API_KEY) throw new Error("Live validation requires configured OpenAI credentials.");
  const actual = await vi.importActual<typeof import("@/lib/ai/openai")>("@/lib/ai/openai");
  const client = actual.getOpenAIClient().withOptions({ maxRetries: 0, timeout: 45000 });
  mocks.ai.mockReturnValue(client);
  const cases = [
    ["Add automated backups to Private Manager", "Tech & Software"],
    ["给 Audi A3 贴车窗黑膜", "Vehicles"],
    ["做一个3D打印的洞洞板支架", "Maker & DIY"],
    ["准备 Polito 数学考试", "Study & Learning"],
    ["以后想处理一些事情", null],
  ] as const;
  const results = [];
  for (const [input, expected] of cases) {
    const response = await chat(request({ messages: [{ role: "user", content: input }] }));
    const data = await response.json();
    if (response.status !== 200) throw new Error(`Live AI validation unavailable (HTTP ${response.status}, ${data.error?.code}).`);
    const name = data.categories.find((category: { id: string; name: string }) => category.id === data.draft?.categoryId)?.name ?? null;
    results.push({ input, expected, phase: data.phase, category: name, draft: data.draft, categories: data.categories, message: data.message });
    console.log(JSON.stringify({ input, expected, phase: data.phase, category: name }));
    if (data.draft) {
      expect(name).toBe(expected);
      for (const categoryId of [data.draft.categoryId, null, data.categories[0].id]) {
        const saved = await finalize(request({ draft: { ...data.draft, categoryId } }));
        expect(saved.status).toBe(200);
        expect((await saved.json()).object.categoryId).toBe(categoryId);
      }
    } else {
      // Clarification about the Object itself remains allowed; never fabricate a draft.
      expect(data.phase).toBe("clarifying");
    }
  }
  await mkdir("coverage", { recursive: true });
  await writeFile("coverage/ai-category-live.json", JSON.stringify(results, null, 2));
}, 240000);

it.skipIf(process.env.RUN_AI_CATEGORY_LIVE !== "1")("live continuation completes clarified category drafts", async () => {
  vi.unstubAllEnvs();
  const actual = await vi.importActual<typeof import("@/lib/ai/openai")>("@/lib/ai/openai");
  mocks.ai.mockReturnValue(actual.getOpenAIClient().withOptions({ maxRetries: 0, timeout: 45000 }));
  const rows = JSON.parse(await readFile("coverage/ai-category-live.json", "utf8"));
  const details: Record<string, string> = {
    "给 Audi A3 贴车窗黑膜": "准备请专业门店给后排侧窗和后挡贴膜，尚未选店或施工。请按当地合规要求给出可编辑的初版草稿，具体参数在选店时确认。",
    "做一个3D打印的洞洞板支架": "我有3D打印机，要做一个把洞洞板固定在书桌上的支架；还没有测量尺寸。请先给出初版草稿，从测量尺寸开始。",
    "准备 Polito 数学考试": "准备一个月后的高数考试，已拿到课程大纲和历年题，还没开始复习。请先给出可编辑初稿。",
    "以后想处理一些事情": "先保留这个宽泛目标，领域和具体事项尚未确定。请做一个轻量、可编辑的初稿，不要猜测领域。",
  };
  for (const row of rows) {
    if (row.draft) continue;
    const messages = [{ role: "user", content: row.input }, ...(row.message ? [{ role: "assistant", content: row.message }] : []), { role: "user", content: details[row.input] }];
    const response = await chat(request({ messages }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.draft).not.toBeNull();
    const category = data.categories.find((item: { id: string; name: string }) => item.id === data.draft.categoryId)?.name ?? null;
    expect(category).toBe(row.expected);
    Object.assign(row, { firstPhase: row.phase, phase: data.phase, category, draft: data.draft, categories: data.categories, message: data.message });
    for (const categoryId of [data.draft.categoryId, null, data.categories[0].id]) {
      const saved = await finalize(request({ draft: { ...data.draft, categoryId } }));
      expect(saved.status).toBe(200);
      expect((await saved.json()).object.categoryId).toBe(categoryId);
    }
  }
  await writeFile("coverage/ai-category-live.json", JSON.stringify(rows, null, 2));
}, 240000);
