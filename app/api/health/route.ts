import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { getAuthConfig } from "@/lib/auth/config";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    getAuthConfig();
    // Also fails if the required schema migration has not been run.
    await getDb().execute(sql`select category_id from objects limit 1`);
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
