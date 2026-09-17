import { loadEnvConfig } from "@next/env";
import { backfillBroadCategories } from "../lib/db/broad-category-backfill";
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--dry-run", "--apply"].includes(args[0])) throw new Error("Explicit mode required.");
  loadEnvConfig(process.cwd());
  const report = await backfillBroadCategories(args[0] === "--dry-run");
  console.log("Category Backfill");
  console.log(`Total imported Objects: ${report.totalImported}`);
  console.log(report.dryRun ? "Would assign:" : "Assigned:");
  for (const [name, count] of Object.entries(report.assignments)) console.log(`  ${name}: ${count}`);
  console.log(`Would remain uncategorized: ${report.uncategorized}`);
  console.log(`Already categorized: ${report.alreadyCategorized}`);
  console.log(`Invalid / missing metadata: ${report.invalidMetadata}`);
  console.log(`Changed: ${report.changed}`);
}
main().catch(() => { console.error("Category backfill failed safely. Use --dry-run or --apply after applying migrations."); process.exitCode = 1; }).finally(async () => {
  const client = (globalThis as unknown as { dbClient?: { end: (options: { timeout: number }) => Promise<void> } }).dbClient;
  if (client) await client.end({ timeout: 1 });
});
