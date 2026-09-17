import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { deriveNextAction } from "@/lib/objects/next-action";
import type { ObjectStatus } from "@/lib/types/object";

// Fixed private-manager import namespace. Never change after a successful import.
export const IMPORT_NAMESPACE = "a5a6a8e2-f30f-4cbf-b3d4-3c718f099f87";
export function legacyObjectId(id: string): string {
  const bytes = createHash("sha1").update(Buffer.from(IMPORT_NAMESPACE.replaceAll("-", ""), "hex")).update(`kanban_tool:${id}`).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex"); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const stageMap: Record<string, ObjectStatus> = { "da fare": "ready", "in esecuzione": "doing", failed: "waiting", completato: "done", cancel: "ready" };

/** Source timestamps have no offset. Assume the explicitly reported source timezone.
 * Reject invalid or ambiguous local times rather than silently inventing an offset.
 */
export function parseLegacyTimestamp(value: string, timezone: string): Date | null {
  if (!value.trim()) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) throw new Error("Unsupported timestamp format");
  const wanted = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0)];
  const approximate = Date.UTC(wanted[0], wanted[1]-1, wanted[2], wanted[3], wanted[4], wanted[5]);
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  function parts(time: number) { const values = Object.fromEntries(fmt.formatToParts(new Date(time)).map((part) => [part.type,part.value])); return ["year","month","day","hour","minute","second"].map((key)=>Number(values[key])); }
  const valid: number[] = [];
  // Covers all present-day UTC offsets, including half/quarter-hour timezones.
  for (let quarter = -56; quarter <= 56; quarter++) {
    const candidate = approximate + quarter * 15 * 60 * 1000;
    if (parts(candidate).every((part,index)=>part===wanted[index])) valid.push(candidate);
  }
  if (valid.length !== 1) throw new Error("Invalid or ambiguous local timestamp");
  return new Date(valid[0]);
}
export interface LegacyObject {
  id: string; legacyId: string; sourceRow: number; title: string; status: ObjectStatus; goal: string; currentState: string; nextAction: string;
  archivedAt: Date | null; cancelledAt: Date | null; createdAt: Date; updatedAt: Date; activityContent: string; timestampFallbacks: string[];
}
export interface LegacyPlan { total: number; candidates: LegacyObject[]; invalid: { row: number; legacyId: string; reason: string }[]; duplicateSourceIds: string[]; timezone: string; }
export function planKanbanImport(source: string, now = new Date(), timezone = "Europe/Rome"): LegacyPlan {
  const clean = source.replace(/^\uFEFF/, "").replace(/^sep=\t\r?\n/, "");
  const records: Record<string,string>[] = parse(clean, { delimiter: "\t", columns: true, bom: true, skip_empty_lines: true });
  const plan: LegacyPlan = { total: records.length, candidates: [], invalid: [], duplicateSourceIds: [], timezone };
  const seen = new Set<string>();
  for (const [index, row] of records.entries()) {
    const id = row.ID?.trim() ?? "";
    try {
      if (!/^\d+$/.test(id) || !row.Nome?.trim()) throw new Error("Missing or invalid ID/title");
      if (seen.has(id)) { plan.duplicateSourceIds.push(id); continue; } seen.add(id);
      const stage = row.Stadio?.trim().toLowerCase();
      if (!stage || !Object.hasOwn(stageMap,stage)) throw new Error("Unknown source stage");
      const timestampFallbacks: string[] = [];
      let createdAt: Date | null; let archivedAt: Date | null;
      try { createdAt = parseLegacyTimestamp(row["Creato il"] ?? "", timezone); } catch { throw new Error("Invalid creation timestamp"); }
      try { archivedAt = parseLegacyTimestamp(row["Archiviata il"] ?? "", timezone); } catch { throw new Error("Invalid archive timestamp"); }
      if (!createdAt) { createdAt = now; timestampFallbacks.push("Missing createdAt: migration timestamp used; original creation date unknown."); }
      let cancelledAt: Date | null = null;
      if (stage === "cancel") {
        if (!archivedAt) { archivedAt = now; timestampFallbacks.push("Missing cancel/archive timestamp: migration timestamp used."); }
        cancelledAt = archivedAt;
        timestampFallbacks.push("Independent cancellation time unavailable: archive timestamp used as approximation.");
      }
      const description = row.Descrizione || ""; const blocked = row["Motivo del blocco"] || "";
      const currentState = [description ? "Imported from Kanban Tool.\n\n" + description : stage === "completato" ? "Imported from Kanban Tool. Originally marked completed." : "Imported historical Object.", blocked ? "\nBlocked: " + blocked : ""].join("");
      const metadata = Object.entries(row).filter(([key,value]) => key !== "Descrizione" && value !== "").map(([key,value]) => `${key}: ${value}`).join("\n");
      plan.candidates.push({ id: legacyObjectId(id), legacyId: id, sourceRow: index+1, title: row.Nome.trim(), status: stageMap[stage], goal: "", currentState, nextAction: deriveNextAction([]), archivedAt, cancelledAt, createdAt, updatedAt: now, activityContent: `Imported from Kanban Tool.\n${metadata}${stage === "cancel" ? "\nPrevious workflow column unknown; deterministic Ready fallback used." : ""}\nTimestamp timezone assumption: ${timezone}.`, timestampFallbacks });
    } catch (error) { plan.invalid.push({ row: index+1, legacyId: id, reason: error instanceof Error ? error.message : "Invalid row" }); }
  }
  return plan;
}
export interface ImportStore { existingIds(ids: string[]): Promise<Set<string>>; insert(object: LegacyObject): Promise<boolean>; }
export async function executeKanbanImport(plan: LegacyPlan, store: ImportStore, dryRun: boolean) {
  const existing = await store.existingIds(plan.candidates.map((item)=>item.id));
  const result = { imported: 0, alreadyExisted: 0, wouldImport: 0, failures: [] as { id:string; reason:string }[] };
  for (const item of plan.candidates) {
    if (existing.has(item.id)) { result.alreadyExisted++; continue; }
    result.wouldImport++;
    if (dryRun) continue;
    try { if (await store.insert(item)) result.imported++; else result.alreadyExisted++; }
    catch { result.failures.push({ id: item.id, reason: "Object transaction failed; no partial row retained." }); }
  }
  return result;
}
