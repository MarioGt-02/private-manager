import { NextResponse } from "next/server";
import type { APIErrorCode } from "@/lib/ai/types";

/** Standardized API error shape used by the AI routes. */
export function apiError(
  status: number,
  code: APIErrorCode,
  message: string,
) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}
