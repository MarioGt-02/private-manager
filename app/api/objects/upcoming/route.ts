import { NextResponse } from "next/server";
import { authorizeDataAccess, dataError, privateHeaders } from "@/lib/api/data";
import { getUpcomingOccurrences } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await authorizeDataAccess();
  if (denied) return denied;
  try {
    return NextResponse.json({ occurrences: await getUpcomingOccurrences() }, { headers: privateHeaders });
  } catch {
    return dataError(500, "DATABASE_ERROR", "Could not load upcoming occurrences.");
  }
}