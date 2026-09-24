import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeDataAccess, dataError, privateHeaders } from "@/lib/api/data";
import { tableApiError } from "@/lib/api/table-errors";
import { objectIdSchema } from "@/lib/archive/schemas";
import { deleteObjectTable, getObjectTables, mutateObjectTable } from "@/lib/db/tables";
import { entityIdSchema, tableDetailMutationSchema } from "@/lib/tables/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deleteRequestSchema = z.object({ confirmed: z.literal(true) }).strict();

type RouteParams = { params: Promise<{ objectId: string; tableId: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const { objectId, tableId } = await params;
  const id = objectIdSchema.safeParse(objectId);
  const tableKey = entityIdSchema.safeParse(tableId);
  const input = tableDetailMutationSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !tableKey.success || !input.success) return dataError(400, "INVALID_REQUEST", "Invalid table change.");
  // The body must target the Table in the URL, so a mismatch cannot edit another Table.
  if (input.data.tableId !== tableKey.data) return dataError(400, "INVALID_REQUEST", "Invalid table change.");
  try {
    return NextResponse.json({ table: await mutateObjectTable(id.data, input.data) }, { headers: privateHeaders });
  } catch (error) {
    return tableApiError(error);
  }
}

/** Deleting a Table is destructive, so it requires explicit confirmation. */
export async function DELETE(request: Request, { params }: RouteParams) {
  const denied = await authorizeDataAccess(); if (denied) return denied;
  const { objectId, tableId } = await params;
  const id = objectIdSchema.safeParse(objectId);
  const tableKey = entityIdSchema.safeParse(tableId);
  const input = deleteRequestSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !tableKey.success || !input.success) return dataError(400, "INVALID_REQUEST", "Confirm table deletion before continuing.");
  try {
    await deleteObjectTable(id.data, tableKey.data);
    return NextResponse.json({ tables: await getObjectTables(id.data) ?? [] }, { headers: privateHeaders });
  } catch (error) {
    return tableApiError(error);
  }
}
