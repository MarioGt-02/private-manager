import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as schema from "@/lib/db/schema";
let pg:PGlite;let db:ReturnType<typeof drizzle<typeof schema>>;
vi.mock("@/lib/db/index",()=>({getDb:()=>db}));
const openai=vi.hoisted(()=>vi.fn());vi.mock("@/lib/ai/openai",()=>({getOpenAIClient:openai}));
import { backfillObjectCategories } from "@/lib/db/category-backfill";
import { planCategoryBackfill } from "@/lib/import/category-backfill";
import { legacyObjectId } from "@/lib/import/kanbantool";
import { categoryStyle,currentStatePreview } from "@/lib/presentation/category";
import { getObject } from "@/lib/db/queries";
import { buildJSONExport,buildCSVExport } from "@/lib/portability/export";
import { getExportRows } from "@/lib/db/export";
import { CardBody } from "@/components/board/ObjectCard";
const source='\uFEFFsep=\t\nID\tTipo carta\n101\tInformatica\n102\tLegname\n103\tSport\n104\t\n';
beforeAll(async()=>{pg=new PGlite();db=drizzle(pg,{schema});for(const file of ['0000_flaky_meggan','0001_object_archive_metadata','0002_object_category_presentation','0003_silent_groot','0004_keen_diamondback','0005_boring_quicksilver','0006_faulty_meteorite','0007_clever_annihilus','0008_silky_slapstick'])await pg.exec(await readFile(`drizzle/${file}.sql`,'utf8'));},30000);
beforeEach(async()=>{await pg.exec('TRUNCATE objects CASCADE');});afterAll(async()=>{await pg.close();});
async function existing(id:string,category:string|null=null,provenance=true){
 const objectId=legacyObjectId(id);const timestamp=new Date('2026-09-01T00:00:00Z');
 await db.insert(schema.objects).values({id:objectId,title:'User edited title',goal:'User edited goal',currentState:'User edited state',nextAction:'User edited next',status:'waiting',archivedAt:timestamp,cancelledAt:timestamp,createdAt:timestamp,updatedAt:timestamp,category});
 if(provenance)await db.insert(schema.objectUpdates).values({id:`event-${id}`,objectId,type:'legacy_import',content:`Imported from Kanban Tool\nID: ${id}\nTipo carta: Informatica`,createdAt:timestamp});
 await db.insert(schema.checklistItems).values({id:`item-${id}`,objectId,title:'User added item',completed:true,position:0,createdAt:timestamp,updatedAt:timestamp});
 return objectId;
}
describe('Safe category backfill',()=>{
 it('parses BOM/TSV Tipo carta, preserves names and deterministic IDs',()=>{
  const plan=planCategoryBackfill(source);expect(plan.total).toBe(4);expect(plan.missingCategory).toBe(1);expect(plan.entries[0]).toEqual({id:legacyObjectId('101'),legacyId:'101',category:'Informatica'});
  expect(()=>planCategoryBackfill(source.replace('102\t','101\t'))).toThrow();
 });
 it('dry-run writes nothing; apply fills only null category and preserves edited fields, times, checklist and Activity',async()=>{
  const id=await existing('101');await existing('102','User category');await existing('103',null,false);
  const before=await getExportRows();const plan=planCategoryBackfill(source);
  const dry=await backfillObjectCategories(plan.entries);expect(dry).toMatchObject({wouldFill:1,filled:0,alreadySet:1,notImported:1});expect(await getExportRows()).toEqual(before);
  const apply=await backfillObjectCategories(plan.entries,false);expect(apply.filled).toBe(1);
  const after=await getExportRows();expect(after.objects.map(object=>({...object,category:before.objects.find(old=>old.id===object.id)!.category}))).toEqual(before.objects);
  expect(after.checklistItems).toEqual(before.checklistItems);expect(after.objectUpdates).toEqual(before.objectUpdates);
  expect((await getObject(id))?.category).toBe('Informatica');
  expect((await backfillObjectCategories(plan.entries,false))).toMatchObject({filled:0,alreadySet:2,notImported:1});expect(openai).not.toHaveBeenCalled();
 });
 it('rejects arbitrary identities and rolls back all categories if one update fails',async()=>{
  await existing('101');await existing('102');
  const entries=planCategoryBackfill(source).entries.slice(0,2);
  await expect(backfillObjectCategories([{...entries[0],id:legacyObjectId('999')}],false)).rejects.toThrow();
  await pg.exec("ALTER TABLE objects ADD CONSTRAINT category_test_fail CHECK(category IS NULL OR category <> 'Legname')");
  try{await expect(backfillObjectCategories(entries,false)).rejects.toThrow();expect((await db.select().from(schema.objects)).every(o=>o.category===null)).toBe(true);}finally{await pg.exec('ALTER TABLE objects DROP CONSTRAINT category_test_fail');}
 });
 it('exports category without changing archive/cancel or timestamps',async()=>{
  const id=await existing('101');await backfillObjectCategories(planCategoryBackfill(source).entries,false);
  const rows=await getExportRows();const json=buildJSONExport(rows);expect(json.objects.find(o=>o.id===id)).toMatchObject({category:'Informatica',status:'waiting',archivedAt:'2026-09-01T00:00:00.000Z'});expect(buildCSVExport(rows)).toContain('category');expect(buildCSVExport(rows)).not.toContain('Informatica');
 });
});
describe('Deterministic card presentation',()=>{
 it('preserves familiar category colors and safely handles empty/unknown categories',()=>{
  expect(categoryStyle('Informatica')).toEqual(categoryStyle('informatica'));expect(categoryStyle('Macchina').accent).not.toBe(categoryStyle('Legname').accent);expect(categoryStyle('__proto__')).toEqual(categoryStyle(null));
 });
 it('removes only the known import banner for preview; full stored value is unchanged',()=>{
  const value='Imported from Kanban Tool.\n\n完整历史内容';expect(currentStatePreview(value)).toBe('完整历史内容');expect(value).toContain('Imported from Kanban Tool.');expect(currentStatePreview('User text')).toBe('User text');
 });
 it('uses text category, clamps Board content, and de-emphasizes empty checklist',async()=>{
  const id=await existing('101','Informatica');await db.delete(schema.checklistItems).where(eq(schema.checklistItems.objectId,id));const object=(await getObject(id))!;
  const html=renderToStaticMarkup(createElement(CardBody,{object}));expect(html).not.toContain('Informatica');expect(html).toContain('line-clamp-2');expect(html).toContain('line-clamp-3');expect(html).toContain('No checklist');expect(html).not.toContain('0/0');expect(html).not.toContain('role="progressbar"');
 });
});
