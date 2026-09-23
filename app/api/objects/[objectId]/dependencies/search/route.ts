import { NextResponse } from "next/server";
import { authorizeDataAccess, dataError, privateHeaders } from "@/lib/api/data";
import { objectIdSchema } from "@/lib/archive/schemas";
import { searchDependencyCandidates } from "@/lib/db/dependencies";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const id = objectIdSchema.safeParse((await params).objectId);
  if (!id.success) return dataError(400, "INVALID_REQUEST", "Invalid Object ID.");
  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ candidates: await searchDependencyCandidates(id.data, query) }, { headers: privateHeaders });
  } catch {
    return dataError(500, "DATABASE_ERROR", "Could not search Objects.");
  }
}
