import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { planKanbanImport, executeKanbanImport } from "../lib/import/kanbantool";
import { kanbanImportStore } from "../lib/db/legacy-import";
import { STATUSES } from "../lib/types/object";

async function main() {
  const args = process.argv.slice(2);
  const sourceArg = args.find((arg)=>!arg.startsWith("--"));
  if (!sourceArg || args.some((arg)=>arg.startsWith("--") && arg !== "--dry-run" && !arg.startsWith("--timezone="))) throw new Error('Usage: npm run import:kanbantool -- "data/import/_2026_ Tasks.csv" --dry-run [--timezone=Europe/Rome]');
  const dryRun = args.includes("--dry-run");
  const timezone = args.find((arg)=>arg.startsWith("--timezone="))?.slice(11) || "Europe/Rome";
  const now = new Date(); const source = path.resolve(sourceArg);
  const plan = planKanbanImport(await readFile(source,"utf8"), now, timezone);
  loadEnvConfig(process.cwd());
  let existingCheck = "verified";
  let result;
  try { result = await executeKanbanImport(plan, kanbanImportStore, dryRun); }
  catch {
    if (!dryRun) throw new Error("Cannot verify existing imports. No import attempted.");
    existingCheck = "unavailable: database configuration/connectivity prevented existing-ID lookup";
    // Offline dry-run can still validate the complete file. Never label unknown IDs as absent.
    result = { imported: 0, alreadyExisted: null, wouldImport: plan.candidates.length, failures: [] };
  }
  const active = Object.fromEntries(STATUSES.map((status)=>[status,plan.candidates.filter((item)=>item.status===status && !item.archivedAt).length]));
  const archivedByStatus = Object.fromEntries(STATUSES.map((status)=>[status,plan.candidates.filter((item)=>item.status===status && !!item.archivedAt).length]));
  const report = { source, importedAt: now.toISOString(), dryRun, sourceTimezoneAssumption: timezone, total: plan.total, ...result, existingCheck, active, archivedByStatus, archived: plan.candidates.filter((item)=>item.archivedAt).length, cancelled: plan.candidates.filter((item)=>item.cancelledAt).length, invalid: plan.invalid, duplicateSourceIds: plan.duplicateSourceIds, deterministicMappings: plan.candidates.map((item)=>({ sourceRow:item.sourceRow, legacyId:item.legacyId, id:item.id, status:item.status, createdAt:item.createdAt.toISOString(), archivedAt:item.archivedAt?.toISOString()??null, cancelledAt:item.cancelledAt?.toISOString()??null, timestampFallbacks:item.timestampFallbacks })), updatedAtStrategy:"Migration timestamp; createdAt preserved when valid.", cancelStatusFallback:"Ready; previous workflow column unavailable in source export." };
  const folder = path.resolve("data/import/reports"); await mkdir(folder,{recursive:true});
  const reportPath = path.join(folder,`kanbantool-import-${now.toISOString().replaceAll(":","-")}${dryRun?"-dry-run":""}.json`);
  await writeFile(reportPath,JSON.stringify(report,null,2),"utf8");
  console.log(dryRun ? "Kanban Tool Migration Dry Run — ZERO DB WRITES" : "Kanban Tool Migration");
  console.log(JSON.stringify({ total:report.total, active, archivedByStatus, archived:report.archived, cancelled:report.cancelled, imported:report.imported, alreadyExisted:report.alreadyExisted, wouldImport:report.wouldImport, existingCheck, invalid:report.invalid.length, failures:report.failures.length, duplicateSourceIds:report.duplicateSourceIds.length, report:reportPath },null,2));
  if (plan.invalid.length || result.failures.length) process.exitCode=1;
}
main().catch((error)=>{ console.error(error instanceof Error && error.message.startsWith("Usage:") ? error.message : "Import command failed safely. Check source format and database configuration; no raw data or credentials logged."); process.exitCode=1; }).finally(async ()=>{
  const client=(globalThis as unknown as {dbClient?: {end:(options:{timeout:number})=>Promise<void>}}).dbClient;
  if(client) await client.end({timeout:1});
});
