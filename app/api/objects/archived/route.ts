import { NextResponse } from "next/server";
import { authorizeDataAccess, dataError, privateHeaders } from "@/lib/api/data";
import { archiveQuerySchema } from "@/lib/archive/schemas";
import { getArchivedObjects } from "@/lib/db/archive";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const input = archiveQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) return dataError(400, "INVALID_REQUEST", "Invalid archive query.");
  try { return NextResponse.json(await getArchivedObjects(input.data), { headers: privateHeaders }); }
  catch { return dataError(500, "DATABASE_ERROR", "Could not load archived Objects."); }
}
