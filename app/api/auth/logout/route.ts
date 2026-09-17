import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/errors";
import { isSameOrigin } from "@/lib/auth/origin";
import { destroySession } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiError(400, "INVALID_REQUEST", "Same-origin request required.");
  await destroySession();
  return new NextResponse(null, { status: 303, headers: { Location: "/login", "Cache-Control": "no-store" } });
}
