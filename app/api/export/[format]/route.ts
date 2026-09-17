import { authorizeDataAccess, dataError, privateHeaders } from "@/lib/api/data";
import { getExportRows } from "@/lib/db/export";
import { buildJSONExport, buildCSVExport } from "@/lib/portability/export";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ format: string }> }) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const { format } = await params;
  if (format !== "json" && format !== "csv") return dataError(400, "INVALID_REQUEST", "Choose JSON or CSV export.");
  try {
    const rows = await getExportRows(); const now = new Date();
    const body = format === "json" ? JSON.stringify(buildJSONExport(rows, now), null, 2) : buildCSVExport(rows);
    return new Response(body, { headers: { ...privateHeaders, "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="private-manager-${now.toISOString().slice(0,10)}.${format}"`, "X-Content-Type-Options": "nosniff" } });
  } catch { return dataError(500, "DATABASE_ERROR", "Could not export data. Please try again."); }
}
