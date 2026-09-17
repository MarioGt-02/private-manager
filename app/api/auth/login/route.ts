import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/errors";
import { AuthConfigError } from "@/lib/auth/config";
import { isSameOrigin } from "@/lib/auth/origin";
import { loginSchema, verifyCredentials } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiError(400, "INVALID_REQUEST", "Same-origin request required.");
  let body: unknown;
  try { body = await request.json(); }
  catch { return apiError(400, "INVALID_REQUEST", "Invalid login request."); }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "INVALID_REQUEST", "Enter a username and a password of at most 72 UTF-8 bytes.");
  try {
    if (!await verifyCredentials(parsed.data.username, parsed.data.password)) {
      return apiError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
    }
    await createSession();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof AuthConfigError ? "AUTH_CONFIG_ERROR" : "INTERNAL_ERROR";
    if (error instanceof AuthConfigError) console.warn(`${code}: check server authentication configuration.`);
    else console.error(`${code}: login could not be completed.`);
    return apiError(500, code, "Login is unavailable. Check the server authentication configuration.");
  }
}
