import { NextResponse } from "next/server";
import { authorizeDataAccess, dataError, privateHeaders } from "@/lib/api/data";
import { tableApiError } from "@/lib/api/table-errors";
import { objectIdSchema } from "@/lib/archive/schemas";
import { setObjectTableCells } from "@/lib/db/tables";
import { entityIdSchema, tableCellsWriteSchema } from "@/lib/tables/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ objectId: string; tableId: string }> };

/** One batched write for many cells, so typing never becomes a request storm. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const { objectId, tableId } = await params;
  const id = objectIdSchema.safeParse(objectId);
  const tableKey = entityIdSchema.safeParse(tableId);
  const input = tableCellsWriteSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !tableKey.success || !input.success) return dataError(400, "INVALID_REQUEST", "Invalid cell values.");
  try {
    return NextResponse.json(
      { table: await setObjectTableCells(id.data, tableKey.data, input.data.cells) },
      { headers: privateHeaders },
    );
  } catch (error) {
    return tableApiError(error);
  }
}
