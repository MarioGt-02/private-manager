import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as schema from "@/lib/db/schema";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mocks = vi.hoisted(() => ({ auth: vi.fn(), openai: vi.fn() }));
vi.mock("@/lib/db/index", () => ({ getDb: () => db }));
vi.mock("@/lib/auth/require-auth", () => ({ requireAuth: mocks.auth, UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: mocks.openai }));
import { UnauthorizedError } from "@/lib/auth/require-auth";
import { createObject, getObjects, getObject } from "@/lib/db/queries";
import { changeObjectLifecycle, getArchivedObjects } from "@/lib/db/archive";
import { kanbanImportStore } from "@/lib/db/legacy-import";
import { getExportRows } from "@/lib/db/export";
import { buildJSONExport, buildCSVExport } from "@/lib/portability/export";
import { planKanbanImport, executeKanbanImport, legacyObjectId, parseLegacyTimestamp } from "@/lib/import/kanbantool";
import { deriveNextAction } from "@/lib/objects/next-action";
import { GET as archived } from "@/app/api/objects/archived/route";
import { GET as detail, DELETE as removeObject } from "@/app/api/objects/[objectId]/route";
import { POST as lifecycle } from "@/app/api/objects/[objectId]/lifecycle/route";
import { GET as exportData } from "@/app/api/export/[format]/route";
import { ArchivedRow } from "@/components/archive/ArchiveDrawer";

const now = new Date("2026-09-13T12:00:00Z");
const tsv = 'sep=\t\nStadio\tID\tNome\tTipo carta\tDescrizione\tCreato il\tArchiviata il\tMotivo del blocco\nDa fare\t101\t制作桌子\tLegname\t"Prima riga\n中文 ""testo"""\t2024-08-19 10:00\t\t\nCompletato\t102\taggiusta stampante\tElettrico\tFinito\t2024-01-01 10:00\t2025-01-27 11:00\t\ncancel\t103\tWrap the Car\tMacchina\t\t2024-01-01 10:00\t2024-05-06 12:00\t\ncancel\t104\t取消的目标\t\t\t\t\t\n';
beforeAll(async () => {
  pg = new PGlite(); db = drizzle(pg, { schema });
  await pg.exec(await readFile("drizzle/0000_flaky_meggan.sql", "utf8"));
  await pg.exec("INSERT INTO objects(id,title) VALUES ('preexisting','Pre-migration Object')");
  await pg.exec(await readFile("drizzle/0001_object_archive_metadata.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0002_object_category_presentation.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0003_silent_groot.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0004_keen_diamondback.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0005_boring_quicksilver.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0006_faulty_meteorite.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0007_clever_annihilus.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0008_silky_slapstick.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0009_loose_skin.sql", "utf8"));
  const result = await pg.query<{ archived_at: null; cancelled_at: null }>("select archived_at,cancelled_at from objects where id='preexisting'");
  expect(result.rows).toEqual([{ archived_at: null, cancelled_at: null }]);
}, 30000);
beforeEach(async () => { await pg.exec('TRUNCATE objects CASCADE'); mocks.auth.mockResolvedValue({}); });
afterAll(async () => { await pg.close(); });
async function make(status: "ready" | "doing" | "done" = "doing") {
  return createObject({ title: '中文, "Italiano"\nTitle', status, goal: "Preserve goal", currentState: "Preserve state", checklist: [{ title: "Already complete", completed: true }, { title: "Next step", completed: false }] });
}
function context(objectId: string) { return { params: Promise.resolve({ objectId }) }; }
function request(url: string, body?: unknown) { return new Request(`http://localhost${url}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined); }

describe("Phase 10 archive/cancel persistence", () => {
  it("requires auth and explicit confirmation before deleting an Object", async () => {
    const object = await make();
    mocks.auth.mockRejectedValueOnce(new UnauthorizedError());
    expect((await removeObject(request('/api/objects/delete', { confirmed: true }), context(object.id))).status).toBe(401);
    for (const body of [{}, { confirmed: false }, { confirmed: true, extra: true }]) {
      expect((await removeObject(request('/api/objects/delete', body), context(object.id))).status).toBe(400);
    }
    expect((await removeObject(request('/api/objects/delete', { confirmed: true }), context('bad id'))).status).toBe(400);
    expect(await getObject(object.id)).not.toBeNull();
  });

  it.each(["active", "archive", "cancel"] as const)("deletes only the confirmed %s Object and cascades its checklist and history", async (state) => {
    const object = await make(); const retained = await make();
    if (state !== "active") await changeObjectLifecycle(object.id, state);
    const categories = await db.select().from(schema.categories);
    const retainedBefore = await getObject(retained.id);
    expect((await removeObject(request('/api/objects/delete', { confirmed: true }), context(object.id))).status).toBe(204);
    expect(await getObject(object.id)).toBeNull();
    expect((await getArchivedObjects({ status: "doing", filter: "all", offset: 0 })).objects.some((item) => item.id === object.id)).toBe(false);
    expect(await db.select().from(schema.checklistItems).where(eq(schema.checklistItems.objectId, object.id))).toHaveLength(0);
    expect(await db.select().from(schema.objectUpdates).where(eq(schema.objectUpdates.objectId, object.id))).toHaveLength(0);
    expect(await getObject(retained.id)).toEqual(retainedBefore);
    expect(await db.select().from(schema.categories)).toEqual(categories);
    expect((await removeObject(request('/api/objects/delete', { confirmed: true }), context(object.id))).status).toBe(204);
    expect(mocks.openai).not.toHaveBeenCalled();
  });

  it("defaults metadata to null, archives without altering content/status/checklist and restores original column", async () => {
    const object = await make(); expect(object.archivedAt).toBeNull(); expect(object.cancelledAt).toBeNull();
    const result = await changeObjectLifecycle(object.id, "archive");
    expect(result).toMatchObject({ status: "doing", title: object.title, goal: object.goal, currentState: object.currentState, nextAction: object.nextAction, checklist: object.checklist });
    expect(result.archivedAt).not.toBeNull(); expect(await getObjects()).toEqual([]);
    expect((await getArchivedObjects({ status: "doing", filter: "all", offset: 0 })).objects.map((item)=>item.id)).toEqual([object.id]);
    expect((await getArchivedObjects({ status: "ready", filter: "all", offset: 0 })).objects).toEqual([]);
    const restored = await changeObjectLifecycle(object.id,"restore");
    expect(restored).toMatchObject({ archivedAt: null, cancelledAt: null, status: "doing" });
    expect((await getObjects()).map((item)=>item.id)).toEqual([object.id]);
    expect((await db.select().from(schema.objectUpdates)).map((row)=>row.type)).toEqual(["object_created","object_archived","object_restored"]);
    expect(mocks.openai).not.toHaveBeenCalled();
  });
  it("cancels into the preserved status archive, visibly marks abandonment and restores", async () => {
    const object = await make("ready"); const result = await changeObjectLifecycle(object.id,"cancel");
    expect(result.status).toBe("ready"); expect(result.cancelledAt).toBe(result.archivedAt); expect(result.archivedAt).not.toBeNull();
    expect(await getObjects()).toEqual([]);
    const page = await getArchivedObjects({status:"ready",filter:"cancelled",offset:0});
    const html = renderToStaticMarkup(createElement(ArchivedRow,{object:page.objects[0],disabled:false,onOpen:vi.fn(),onRestore:vi.fn(),onDelete:vi.fn()}));
    expect(html).toContain("line-through"); expect(html).toContain("Cancelled");
    expect((await getArchivedObjects({status:"done",filter:"all",offset:0})).objects).toHaveLength(0);
    const restored = await changeObjectLifecycle(object.id,"restore"); expect(restored).toMatchObject({status:"ready",archivedAt:null,cancelledAt:null});
    expect((await db.select().from(schema.objectUpdates)).some((row)=>row.type==="object_cancelled")).toBe(true);
  });
  it("bounds history, sorts newest first, isolates statuses and allows Active/Completed filtering", async () => {
    await db.insert(schema.objects).values(Array.from({length:35},(_,i)=>({id:`arch-${i}`,title:`Archive ${i}`,status:"doing" as const,archivedAt:new Date(now.getTime()+i*1000)})));
    const first = await getArchivedObjects({status:"doing",filter:"all",offset:0});expect(first.objects).toHaveLength(30);expect(first.objects[0].id).toBe("arch-34");expect(first.nextOffset).toBe(30);
    const second = await getArchivedObjects({status:"doing",filter:"all",offset:30});expect(second.objects).toHaveLength(5);expect(second.nextOffset).toBeNull();
    expect((await archived(request('/api/objects/archived?status=doing&filter=completed'))).status).toBe(200);
    const done=await make("done");await changeObjectLifecycle(done.id,"archive");
    expect((await getArchivedObjects({status:"done",filter:"completed",offset:0})).objects.map(item=>item.id)).toEqual([done.id]);
  });
  it("rolls back metadata when activity insertion fails", async () => {
    const object=await make();
    await pg.exec("ALTER TABLE object_updates ADD CONSTRAINT simulate_failure CHECK(type <> 'object_cancelled')");
    try { await expect(changeObjectLifecycle(object.id,"cancel")).rejects.toThrow();expect((await getObject(object.id))?.archivedAt).toBeNull(); }
    finally { await pg.exec("ALTER TABLE object_updates DROP CONSTRAINT simulate_failure"); }
  });
});

describe("Phase 10 one-time migration", () => {
  it("parses real TSV conventions, quoted multiline Unicode, metadata and timestamp strategies", () => {
    const plan=planKanbanImport(tsv,now);
    expect(plan.total).toBe(4);expect(plan.invalid).toEqual([]);
    expect(plan.candidates[0].currentState).toContain('Prima riga\n中文 "testo"');
    expect(plan.candidates[0]).toMatchObject({goal:"",nextAction:deriveNextAction([]),createdAt:new Date('2024-08-19T08:00:00Z')});
    expect(plan.candidates[1]).toMatchObject({status:"done",archivedAt:new Date('2025-01-27T10:00:00Z'),cancelledAt:null});
    expect(plan.candidates[2]).toMatchObject({status:"ready",archivedAt:new Date('2024-05-06T10:00:00Z'),cancelledAt:new Date('2024-05-06T10:00:00Z')});
    expect(plan.candidates[3]).toMatchObject({status:"ready",createdAt:now,archivedAt:now,cancelledAt:now});
    expect(plan.candidates[3].timestampFallbacks.length).toBeGreaterThan(1);
    expect(plan.candidates[0].activityContent).toContain("Legname");
    expect(legacyObjectId("101")).toMatch(/^[a-f0-9-]{14}5[a-f0-9-]{21}$/);
    expect(legacyObjectId("101")).toBe(legacyObjectId("101"));
    expect(legacyObjectId("101")).not.toBe(legacyObjectId("102"));
  });
  it("maps Doing/Failed and rejects invalid or ambiguous timestamps and duplicate source identities", () => {
    expect(planKanbanImport(tsv.replace('Da fare','In esecuzione'),now).candidates[0].status).toBe('doing');
    expect(planKanbanImport(tsv.replace('Da fare','Failed'),now).candidates[0].status).toBe('waiting');
    expect(()=>parseLegacyTimestamp('2024-02-30 10:00','Europe/Rome')).toThrow();
    expect(()=>parseLegacyTimestamp('2024-10-27 02:30','Europe/Rome')).toThrow();
    expect(planKanbanImport(tsv.replace('\t102\t','\t101\t'),now).duplicateSourceIds).toEqual(['101']);
  });
  it("dry-run has zero writes; second import skips previously edited rows", async () => {
    const plan=planKanbanImport(tsv,now);
    expect((await executeKanbanImport(plan,kanbanImportStore,true)).wouldImport).toBe(4);
    expect(await db.select().from(schema.objects)).toHaveLength(0);expect(await db.select().from(schema.objectUpdates)).toHaveLength(0);
    expect((await executeKanbanImport(plan,kanbanImportStore,false)).imported).toBe(4);
    await db.update(schema.objects).set({title:"Edited after import"}).where(eq(schema.objects.id,legacyObjectId("101")));
    expect((await executeKanbanImport(plan,kanbanImportStore,false)).alreadyExisted).toBe(4);
    expect((await getObject(legacyObjectId("101")))?.title).toBe("Edited after import");
    expect(await db.select().from(schema.checklistItems)).toHaveLength(0);
    expect((await db.select().from(schema.objectUpdates)).every(row=>row.type==="legacy_import")).toBe(true);
    expect(mocks.openai).not.toHaveBeenCalled();
  });
  it("rolls back an individual failed import but continues other valid rows", async () => {
    const rejected=legacyObjectId("101");
    await pg.exec(`ALTER TABLE object_updates ADD CONSTRAINT simulate_import_failure CHECK(object_id <> '${rejected}')`);
    try { const result=await executeKanbanImport(planKanbanImport(tsv,now),kanbanImportStore,false);expect(result.failures).toHaveLength(1);expect(result.imported).toBe(3);expect(await getObject(rejected)).toBeNull(); }
    finally { await pg.exec('ALTER TABLE object_updates DROP CONSTRAINT simulate_import_failure'); }
  });
});

describe("Phase 10 authenticated data boundaries/export", () => {
  it("denies archive, detail, lifecycle and export before DB/AI work", async () => {
    mocks.auth.mockRejectedValue(new UnauthorizedError());const select=vi.spyOn(db,"select");const transaction=vi.spyOn(db,"transaction");
    expect((await archived(request('/api/objects/archived?status=doing'))).status).toBe(401);
    expect((await detail(request('/api/objects/x'),context('x'))).status).toBe(401);
    expect((await lifecycle(request('/api/objects/x/lifecycle',{action:'archive'}),context('x'))).status).toBe(401);
    expect((await exportData(request('/api/export/json'),{params:Promise.resolve({format:'json'})})).status).toBe(401);
    expect(select).not.toHaveBeenCalled();expect(transaction).not.toHaveBeenCalled();expect(mocks.openai).not.toHaveBeenCalled();select.mockRestore();transaction.mockRestore();
  });
  it("requires explicit cancel confirmation and validates status", async () => {
    const object=await make();expect((await lifecycle(request('/api/lifecycle',{action:'cancel'}),context(object.id))).status).toBe(400);
    expect((await getObject(object.id))?.archivedAt).toBeNull();expect((await archived(request('/api/objects/archived?status=cancelled'))).status).toBe(400);
  });
  it("exports live/archive/cancel data, IDs, timestamps, checklist/activity while excluding config", async () => {
    const live=await make();const history=await make('done');await changeObjectLifecycle(history.id,'archive');const cancelled=await make('ready');await changeObjectLifecycle(cancelled.id,'cancel');
    const before=(await db.select().from(schema.objectUpdates)).length;
    const rows=await getExportRows();const json=buildJSONExport(rows,now);
    expect(json.format).toBe('private-manager-export');expect(json.version).toBe(1);expect(json.objects).toHaveLength(3);expect(json.checklistItems).toHaveLength(6);expect(json.objectUpdates).toHaveLength(before);
    expect(json.objects.find(row=>row.id===live.id)?.archivedAt).toBeNull();expect(json.objects.find(row=>row.id===cancelled.id)?.cancelledAt).not.toBeNull();
    const augmented={...rows,AUTH_SECRET:'never-export',objects:rows.objects.map(row=>({...row,passwordHash:'never-export',OPENAI_API_KEY:'never-export'}))};
    expect(JSON.stringify(buildJSONExport(augmented))).not.toContain('never-export');
    const csv=buildCSVExport(rows);const decoded=parse(csv,{bom:true,columns:true}) as Record<string,string>[];expect(decoded).toHaveLength(3);expect(decoded.find((row)=>row.id===live.id)?.title).toBe(live.title);
    expect(decoded.find((row)=>row.id===cancelled.id)?.cancelled).toBe('1');
    const response=await exportData(request('/api/export/json'),{params:Promise.resolve({format:'json'})});expect(response.status).toBe(200);expect(response.headers.get('content-disposition')).toMatch(/private-manager-.*\.json/);expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await db.select().from(schema.objectUpdates)).length).toBe(before);expect(mocks.openai).not.toHaveBeenCalled();
  });
});
