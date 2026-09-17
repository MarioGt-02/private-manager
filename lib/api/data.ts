import { NextResponse } from "next/server";
import { requireAuth, UnauthorizedError } from "@/lib/auth/require-auth";
export const privateHeaders = { "Cache-Control": "no-store" };
export function dataError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: privateHeaders });
}
export async function authorizeDataAccess() {
  try { await requireAuth(); return null; }
  catch (error) { return error instanceof UnauthorizedError ? dataError(401, "UNAUTHORIZED", "Authentication required.") : dataError(500, "INTERNAL_ERROR", "Authentication could not be verified."); }
}
