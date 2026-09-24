import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as schema from "@/lib/db/schema";
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), ai: vi.fn() }));
vi.mock("@/lib/db/index", () => ({ getDb: () => { mocks.db(); return db; } }));
vi.mock("@/lib/auth/require-auth", () => ({ requireAuth: mocks.auth, UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: mocks.ai }));
import { UnauthorizedError } from "@/lib/auth/require-auth";
import { GET, POST } from "@/app/api/categories/route";
import { getCategories, saveCategory, assignCategory } from "@/lib/db/categories";
import { backfillBroadCategories } from "@/lib/db/broad-category-backfill";
import { getExportRows } from "@/lib/db/export";
import { buildJSONExport, buildCSVExport } from "@/lib/portability/export";
import { createObject, getObject } from "@/lib/db/queries";
import { DEFAULT_CATEGORIES, categoryInputSchema } from "@/lib/categories/model";
import { mapLegacyCategory } from "@/lib/categories/backfill";
import { CategoryContext } from "@/components/categories/CategoryContext";
import { CategoryColorPicker } from "@/components/categories/CategoryColorPicker";
import { ObjectCardOverlay } from "@/components/board/ObjectCard";
import { ArchivedRow } from "@/components/archive/ArchiveDrawer";
import { colorStyle } from "@/lib/categories/colors";
import { parse } from "csv-parse/sync";

beforeAll(async () => {
  pg = new PGlite(); db = drizzle(pg, { schema });
  for (const file of ["0000_flaky_meggan", "0001_object_archive_metadata", "0002_object_category_presentation", "0003_silent_groot", "0004_keen_diamondback", "0005_boring_quicksilver", "0006_faulty_meteorite", "0007_clever_annihilus","0008_silky_slapstick"]) await pg.exec(await readFile(`drizzle/${file}.sql`, "utf8"));
}, 30000);
beforeEach(async () => { await pg.exec("TRUNCATE objects CASCADE"); mocks.auth.mockReset().mockResolvedValue({}); mocks.db.mockClear(); mocks.ai.mockClear(); });
afterAll(async () => { await pg.close(); });
const tech = DEFAULT_CATEGORIES[0];
function request(body: unknown) { return new Request("http://localhost/api/categories", { method: "POST", body: JSON.stringify(body) }); }
async function imported(id: string, category: string | null, categoryId: string | null = null) {
  await db.insert(schema.objects).values({ id, title: "User edited exam title", category, categoryId, currentState: "User progress", status: "done", archivedAt: new Date("2026-01-01"), cancelledAt: new Date("2026-01-01") });
  await db.insert(schema.objectUpdates).values({ id: `import-${id}`, objectId: id, type: "legacy_import", content: "Preserved import." });
  await db.insert(schema.checklistItems).values({ id: `check-${id}`, objectId: id, title: "User checklist", completed: true, position: 0 });
}

describe("Category persistence and auth", () => {
  it("defaults null, seeds exactly eight defaults, validates names and token colors", async () => {
    const object = await createObject({ title: "New Object" }); expect(object.categoryId).toBeNull();
    expect((await getCategories()).filter((category) => DEFAULT_CATEGORIES.some((item) => item.id === category.id))).toHaveLength(8);
    expect(categoryInputSchema.safeParse({ name: "  ", color: "blue" }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ name: "Test", color: "#123456" }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ name: "Test", color: "blue", extra: true }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ name: "Test", color: "yellow" }).success).toBe(true);
    await expect(saveCategory({ name: "  TECH & SOFTWARE  ", color: "blue" })).rejects.toThrow();
    const custom = await saveCategory({ name: "  My category  ", color: "teal" }); expect(custom.name).toBe("My category");
    expect(await saveCategory({ name: "Yellow category", color: "yellow" })).toMatchObject({ color: "yellow" });
    expect(await saveCategory({ name: "My renamed category", color: "brown" }, custom.id)).toMatchObject({ id: custom.id, name: "My renamed category", color: "brown" });
  });
  it("enforces foreign key; assignment, change and clear do not add Activity noise", async () => {
    const object = await createObject({ title: "Object" });
    await expect(assignCategory(object.id, "missing")).rejects.toThrow();
    await expect(db.update(schema.objects).set({ categoryId: "missing" }).where(eq(schema.objects.id, object.id))).rejects.toThrow();
    await assignCategory(object.id, tech.id); await assignCategory(object.id, DEFAULT_CATEGORIES[1].id); await assignCategory(object.id, null);
    expect((await getObject(object.id))?.categoryId).toBeNull();
    const events = (await getExportRows()).objectUpdates.filter((row) => row.type === "category_changed");
    expect(events).toHaveLength(0);
    await assignCategory(object.id, tech.id);
    const before = await getExportRows();
    await saveCategory({ name: tech.name, color: "cyan" }, tech.id);
    expect((await getExportRows()).objects).toEqual(before.objects); expect((await getExportRows()).objectUpdates).toEqual(before.objectUpdates);
    await saveCategory({ name: tech.name, color: tech.color }, tech.id);
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it("does not rely on Activity writes for category assignment", async () => {
    const object = await createObject({ title: "Object" }); const before = await getExportRows();
    await pg.exec("ALTER TABLE object_updates ADD CONSTRAINT fail_category_event CHECK(type <> 'category_changed')");
    try { await assignCategory(object.id, tech.id); expect((await getObject(object.id))?.categoryId).toBe(tech.id); expect((await getExportRows()).objectUpdates).toEqual(before.objectUpdates); }
    finally { await pg.exec("ALTER TABLE object_updates DROP CONSTRAINT fail_category_event"); }
  });
  it("all category boundaries require auth before DB access", async () => {
    for (const body of [{ action: "create", category: { name: "X", color: "blue" } }, { action: "update", id: tech.id, category: { name: "X", color: "cyan" } }, { action: "assign", objectId: "object", categoryId: null }]) {
      mocks.auth.mockRejectedValueOnce(new UnauthorizedError()); mocks.db.mockClear();
      expect((await POST(request(body))).status).toBe(401); expect(mocks.db).not.toHaveBeenCalled();
    }
    mocks.auth.mockRejectedValueOnce(new UnauthorizedError()); mocks.db.mockClear();
    expect((await GET()).status).toBe(401); expect(mocks.db).not.toHaveBeenCalled();
    expect((await POST(request({ action: "create", category: { name: "X", color: "invalid" } }))).status).toBe(400);
  });
});

describe("Deterministic broad backfill", () => {
  it.each([
    ["Informatica", 0], ["GameMake", 0], ["Elettrico", 1], ["Legname", 1], ["Stampante 3D", 1], ["3D modeling", 1], ["cucire", 1], ["casa", 2], ["Cucina", 2], ["Macchina", 3], ["Fotografia", 4], ["Disegno", 4], ["Musica", 4], ["Sport", 5], ["Busnis", 6],
  ])("maps %s from source metadata", (source, index) => { expect(mapLegacyCategory(source)?.id).toBe(DEFAULT_CATEGORIES[index].id); });
  it.each(["Lavoro urgente", "Predefinito", "unknown", "", null])("leaves %s unclassified", (value) => { expect(mapLegacyCategory(value)).toBeNull(); });
  it("dry-run is read only; apply changes only null categoryId and repeat is idempotent", async () => {
    await imported("a", "Informatica"); await imported("b", "Macchina", tech.id); await imported("c", "Lavoro urgente"); await imported("d", null);
    await db.insert(schema.objects).values({ id: "manual", title: "Manual", category: "Informatica" });
    const before = await getExportRows();
    const dry = await backfillBroadCategories(); expect(dry).toMatchObject({ totalImported: 4, changed: 0, alreadyCategorized: 1, uncategorized: 1, invalidMetadata: 1 });
    expect(dry.assignments[tech.name]).toBe(1); expect(await getExportRows()).toEqual(before);
    expect((await backfillBroadCategories(false)).changed).toBe(1);
    const after = await getExportRows();
    expect(after.objects.map((row) => ({ ...row, categoryId: before.objects.find((old) => old.id === row.id)!.categoryId }))).toEqual(before.objects);
    expect(after.objectUpdates).toEqual(before.objectUpdates); expect(after.checklistItems).toEqual(before.checklistItems);
    expect(after.objects.find((row) => row.id === "a")?.categoryId).toBe(tech.id);
    expect((await backfillBroadCategories(false)).changed).toBe(0); expect(mocks.ai).not.toHaveBeenCalled();
  });
  it("a failed row rolls back the whole batch", async () => {
    await imported("a", "Informatica"); await imported("b", "Legname"); const before = await getExportRows();
    await pg.exec(`ALTER TABLE objects ADD CONSTRAINT fail_backfill CHECK(category_id IS NULL OR category_id <> '${DEFAULT_CATEGORIES[1].id}')`);
    try { await expect(backfillBroadCategories(false)).rejects.toThrow(); expect(await getExportRows()).toEqual(before); }
    finally { await pg.exec("ALTER TABLE objects DROP CONSTRAINT fail_backfill"); }
  });
});

describe("Category presentation and exports", () => {
  it("JSON exports categories and IDs; CSV resolves current name/color, not legacy metadata", async () => {
    const object = await createObject({ title: "Categorized" }); await assignCategory(object.id, tech.id);
    const empty = await createObject({ title: "Uncategorized" });
    const rows = await getExportRows(); const json = buildJSONExport(rows);
    expect(json.categories.find((row) => row.id === tech.id)).toMatchObject({ name: tech.name, color: "blue" });
    expect(json.objects.find((row) => row.id === object.id)?.categoryId).toBe(tech.id);
    const csv = parse(buildCSVExport(rows), { bom: true, columns: true }) as Record<string, string>[];
    expect(csv.find((row) => row.id === object.id)).toMatchObject({ category: tech.name, category_color: "blue" });
    expect(csv.find((row) => row.id === empty.id)).toMatchObject({ category: "", category_color: "" });
    for (const secret of ["OPENAI_API_KEY", "DATABASE_URL", "AUTH_SECRET", "password"]) expect(JSON.stringify(json)).not.toContain(secret);
  });
  it("uses category records for chips and accents, neutral null, accessible swatches, cancelled semantics", async () => {
    const object = await createObject({ title: "Object" });
    const render = (child: ReturnType<typeof createElement>, color = "blue") => renderToStaticMarkup(createElement(CategoryContext.Provider, { value: { categories: [{ ...tech, color: color as "blue", createdAt: new Date().toISOString() }], error: "", loading: false, reload: vi.fn(), saved: vi.fn() } }, child));
    const card = { ...object, categoryId: tech.id };
    const blue = render(createElement(ObjectCardOverlay, { object: card }));
    expect(blue).toContain("Tech &amp; Software"); expect(blue).toContain(colorStyle("blue").accent); expect(blue).toContain("bg-white");
    expect(render(createElement(ObjectCardOverlay, { object: card }), "cyan")).toContain(colorStyle("cyan").accent);
    const neutral = render(createElement(ObjectCardOverlay, { object })); expect(neutral).not.toContain(tech.name); expect(neutral).toContain(colorStyle(null).accent);
    const swatches = renderToStaticMarkup(createElement(CategoryColorPicker, { value: "blue", onChange: vi.fn() })); expect(swatches).toContain('aria-pressed="true"'); expect(swatches).toContain("✓"); expect(swatches).toContain('aria-label="blue"'); expect(swatches).toContain('aria-label="yellow"');
    const archived = render(createElement(ArchivedRow, { object: { ...card, archivedAt: new Date().toISOString(), cancelledAt: new Date().toISOString() }, disabled: false, onOpen: vi.fn(), onRestore: vi.fn(), onDelete: vi.fn() }));
    expect(archived).toContain("Tech &amp; Software"); expect(archived).toContain(colorStyle("blue").accent); expect(archived).toContain("line-through"); expect(archived).toContain("Cancelled");
  });
});
