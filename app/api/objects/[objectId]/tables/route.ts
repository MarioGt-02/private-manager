import { NextResponse } from "next/server";
import { authorizeDataAccess, dataError, privateHeaders } from "@/lib/api/data";
import { tableApiError } from "@/lib/api/table-errors";
import { objectIdSchema } from "@/lib/archive/schemas";
import { createObjectTable, getObjectTables } from "@/lib/db/tables";
import { tableCreateSchema } from "@/lib/tables/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All Tables of one Object, with columns, rows and cells, in one request. */
export async function GET(_request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const id = objectIdSchema.safeParse((await params).objectId);
  if (!id.success) return dataError(400, "INVALID_REQUEST", "Invalid Object ID.");
  try {
    const tables = await getObjectTables(id.data);
    return tables
      ? NextResponse.json({ tables }, { headers: privateHeaders })
      : dataError(404, "OBJECT_NOT_FOUND", "Object not found.");
  } catch (error) {
    return tableApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const id = objectIdSchema.safeParse((await params).objectId);
  const input = tableCreateSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success) return dataError(400, "INVALID_REQUEST", "Invalid table request.");
  try {
    return NextResponse.json({ table: await createObjectTable(id.data, input.data) }, { headers: privateHeaders });
  } catch (error) {
    return tableApiError(error);
  }
}
