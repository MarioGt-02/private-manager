import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getAuthConfig } from "./config";

export const SESSION_COOKIE = "private_manager_session";
export type Session = { authenticated: true; username: string; iat: number; exp: number };

export function cookieOptions() {
  // Explicit opt-out for trusted-LAN HTTP testing; production defaults secure.
  return { httpOnly: true, sameSite: "lax" as const, path: "/", secure: process.env.NODE_ENV === "production" && process.env.AUTH_COOKIE_SECURE !== "false" };
}

export async function createSession() {
  const config = getAuthConfig();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + config.sessionDays * 86400;
  // Signed, NOT encrypted. Never put private data or credentials here.
  const token = await new SignJWT({ authenticated: true, username: config.username })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(iat).setExpirationTime(exp)
    .sign(new TextEncoder().encode(config.secret));
  (await cookies()).set(SESSION_COOKIE, token, {
    ...cookieOptions(), maxAge: exp - iat, expires: new Date(exp * 1000),
  });
}

export async function getSession(): Promise<Session | null> {
  try {
    const config = getAuthConfig();
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || token.length > 4096) return null;
    const { payload } = await jwtVerify(token, new TextEncoder().encode(config.secret), {
      algorithms: ["HS256"], typ: "JWT", requiredClaims: ["iat", "exp"],
    });
    const now = Math.floor(Date.now() / 1000);
    if (payload.authenticated !== true || payload.username !== config.username ||
      typeof payload.iat !== "number" || !Number.isInteger(payload.iat) ||
      typeof payload.exp !== "number" || !Number.isInteger(payload.exp) ||
      payload.iat > now || payload.exp <= payload.iat ||
      Object.keys(payload).some((key) => !["authenticated", "username", "iat", "exp"].includes(key))) return null;
    return payload as Session;
  } catch {
    // Missing configuration and invalid cookies are expected unauthenticated
    // states. Logging console.error during rendering opens Next's dev overlay.
    // The login endpoint supplies a safe diagnostic on an actual login attempt.
    return null;
  }
}

export async function destroySession() {
  (await cookies()).set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0, expires: new Date(0) });
}
