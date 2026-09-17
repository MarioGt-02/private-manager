import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { SignJWT, decodeJwt } from "jose";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  set: vi.fn(),
  dbRead: vi.fn(async () => []),
  create: vi.fn(), status: vi.fn(), checklist: vi.fn(), openai: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => state.jar.has(name) ? { value: state.jar.get(name) } : undefined,
  set: state.set,
}) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/lib/db/queries", () => ({ getObjects: state.dbRead, createObject: state.create, updateObjectStatus: state.status, updateChecklistItem: state.checklist }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: state.openai }));
vi.mock("@/components/board/Board", () => ({ Board: () => null }));
vi.mock("@/components/auth/LoginForm", () => ({ LoginForm: () => null }));

import { getAuthConfig, AuthConfigError } from "@/lib/auth/config";
import { DUMMY_PASSWORD_HASH, loginSchema, verifyCredentials } from "@/lib/auth/password";
import { createSession, getSession, SESSION_COOKIE, cookieOptions } from "@/lib/auth/session";
import { requireAuth } from "@/lib/auth/require-auth";
import { isSameOrigin } from "@/lib/auth/origin";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as chat } from "@/app/api/ai/create-object/chat/route";
import { POST as finalize } from "@/app/api/ai/create-object/finalize/route";
import { moveObjectToStatus, setChecklistItemCompleted } from "@/lib/actions/object-actions";
import Home from "@/app/page";
import LoginPage from "@/app/login/page";

const password = randomBytes(18).toString("hex");
const secret = randomBytes(32).toString("hex");
let passwordHash: string;
beforeAll(async () => { passwordHash = await bcrypt.hash(password, 12); });
beforeEach(() => {
  vi.stubEnv("AUTH_USERNAME", "test-user");
  vi.stubEnv("AUTH_PASSWORD_HASH", passwordHash);
  vi.stubEnv("AUTH_SECRET", secret);
  vi.stubEnv("AUTH_SESSION_DAYS", "30");
  vi.stubEnv("NODE_ENV", "development");
  state.jar.clear();
  state.set.mockImplementation((name: string, value: string) => { state.jar.set(name, value); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function request(body: unknown, path = "login") {
  return new Request(`http://app.test/api/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://app.test" }, body: JSON.stringify(body) });
}
async function signed(payload: Record<string, unknown>, alg = "HS256") {
  return new SignJWT(payload).setProtectedHeader({ alg, typ: "JWT" }).sign(new TextEncoder().encode(secret));
}

describe("credentials and configuration", () => {
  it("keeps production cookies secure unless LAN HTTP is explicitly selected", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_COOKIE_SECURE", "");
    expect(cookieOptions()).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax" });
    vi.stubEnv("AUTH_COOKIE_SECURE", "false");
    expect(cookieOptions()).toMatchObject({ secure: false, httpOnly: true, sameSite: "lax" });
    expect(isSameOrigin(request({}))).toBe(true);
    expect(isSameOrigin(new Request("http://app.test/api/auth/login", { headers: { Origin: "http://evil.test" } }))).toBe(false);
    vi.stubEnv("AUTH_COOKIE_SECURE", "true");
    expect(cookieOptions().secure).toBe(true);
    expect(isSameOrigin(request({}))).toBe(false);
  });
  it("verifies valid credentials and rejects wrong passwords", async () => {
    expect(await verifyCredentials("test-user", password)).toBe(true);
    expect(await verifyCredentials("test-user", "wrong")).toBe(false);
  });
  it("compares the fixed cost-12 dummy hash exactly once for a wrong username", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    expect(await verifyCredentials("unknown", password)).toBe(false);
    expect(compare).toHaveBeenCalledExactlyOnceWith(password, DUMMY_PASSWORD_HASH);
    expect(bcrypt.getRounds(DUMMY_PASSWORD_HASH)).toBe(12);
  });
  it("rejects empty and oversized multibyte passwords", () => {
    for (const value of ["", "a".repeat(73), "界".repeat(25)]) {
      expect(loginSchema.safeParse({ username: "test-user", password: value }).success).toBe(false);
    }
    expect(loginSchema.safeParse({ username: "test-user", password: "界".repeat(24) }).success).toBe(true);
  });
  it.each(["AUTH_USERNAME", "AUTH_PASSWORD_HASH", "AUTH_SECRET"])("fails closed without %s", async (key) => {
    vi.stubEnv(key, "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => getAuthConfig()).toThrow(AuthConfigError);
    expect(await getSession()).toBeNull();
    expect((await login(request({ username: "test-user", password }))).status).toBe(500);
    await expect(requireAuth()).rejects.toThrow("Unauthorized");
  });
  it.each(["0", "366", "1.5", "abc", ""])("rejects invalid session days %s", (value) => {
    vi.stubEnv("AUTH_SESSION_DAYS", value);
    expect(() => getAuthConfig()).toThrow(AuthConfigError);
  });
  it("rejects short secrets and malformed hashes", () => {
    vi.stubEnv("AUTH_SECRET", "short");
    expect(() => getAuthConfig()).toThrow(AuthConfigError);
    vi.stubEnv("AUTH_SECRET", secret);
    vi.stubEnv("AUTH_PASSWORD_HASH", "invalid");
    expect(() => getAuthConfig()).toThrow(AuthConfigError);
  });
  it("requires the same cost as the dummy hash and defaults to 30 days", () => {
    vi.stubEnv("AUTH_SESSION_DAYS", undefined);
    expect(getAuthConfig().sessionDays).toBe(30);
    vi.stubEnv("AUTH_PASSWORD_HASH", passwordHash.replace("$12$", "$10$"));
    expect(() => getAuthConfig()).toThrow(AuthConfigError);
  });
});

describe("session integrity and lifecycle", () => {
  it("creates only the minimal payload and validates repeated reads", async () => {
    await createSession();
    const payload = decodeJwt(state.jar.get(SESSION_COOKIE)!);
    expect(Object.keys(payload).sort()).toEqual(["authenticated", "exp", "iat", "username"]);
    expect(payload.exp! - payload.iat!).toBe(30 * 86400);
    expect(await getSession()).toEqual(payload);
    expect(await getSession()).toEqual(payload);
    expect(state.set.mock.calls[0][2]).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: false, maxAge: 30 * 86400 });
    vi.stubEnv("NODE_ENV", "production");
    expect(cookieOptions().secure).toBe(true);
  });
  it("rejects malformed and tampered cookies", async () => {
    await createSession();
    const token = state.jar.get(SESSION_COOKIE)!;
    const parts = token.split(".");
    parts[1] = Buffer.from(JSON.stringify({ authenticated: true, username: "attacker" })).toString("base64url");
    for (const value of ["garbage", parts.join("."), token.slice(0, -10)]) {
      state.jar.set(SESSION_COOKIE, value);
      expect(await getSession()).toBeNull();
    }
  });
  it("rejects expired, malformed, future-issued, wrong-user and extra-field payloads", async () => {
    const now = Math.floor(Date.now() / 1000);
    const base = { authenticated: true, username: "test-user", iat: now - 10, exp: now + 100 };
    for (const change of [{ exp: now - 1 }, { authenticated: false }, { username: "other" }, { iat: now + 20 }, { iat: "bad" }, { exp: undefined }, { privateData: "forbidden" }]) {
      state.jar.set(SESSION_COOKIE, await signed({ ...base, ...change }));
      expect(await getSession()).toBeNull();
    }
    state.jar.set(SESSION_COOKIE, await signed(base, "HS384"));
    expect(await getSession()).toBeNull();
  });
  it("secret rotation invalidates existing sessions", async () => {
    await createSession();
    vi.stubEnv("AUTH_SECRET", randomBytes(32).toString("hex"));
    expect(await getSession()).toBeNull();
  });
});

describe("HTTP and server trust boundaries", () => {
  it("renders a safe setup notice without a console error when auth is unconfigured", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = renderToStaticMarkup(await LoginPage());
    expect(html).toContain("Please check the server authentication configuration.");
    expect(html).not.toContain(secret);
    expect(html).not.toContain(passwordHash);
    expect(await getSession()).toBeNull();
    await expect(Home()).rejects.toThrow("REDIRECT:/login");
    const response = await login(request({ username: "test-user", password }));
    expect(response.status).toBe(500);
    expect(warning).toHaveBeenCalledExactlyOnceWith("AUTH_CONFIG_ERROR: check server authentication configuration.");
    expect(errorLog).not.toHaveBeenCalled();
    expect(state.dbRead).not.toHaveBeenCalled();
    expect(state.set).not.toHaveBeenCalled();
  });
  it("uses identical safe errors for wrong username and wrong password", async () => {
    const a = await login(request({ username: "unknown", password }));
    const b = await login(request({ username: "test-user", password: "wrong" }));
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
    expect(state.set).not.toHaveBeenCalled();
  });
  it("rejects invalid JSON and cross-origin login without a cookie", async () => {
    expect((await login(new Request("http://app.test/api/auth/login", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await login(new Request("http://app.test/api/auth/login", { method: "POST", headers: { origin: "https://evil.test" } }))).status).toBe(400);
    expect(state.set).not.toHaveBeenCalled();
  });
  it("supports login, authenticated board/refresh, login redirect, logout and denied refresh", async () => {
    const result = await login(request({ username: "test-user", password }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
    expect(result.headers.get("cache-control")).toBe("no-store");
    await Home(); await Home();
    expect(state.dbRead).toHaveBeenCalledTimes(2);
    await expect(LoginPage()).rejects.toThrow("REDIRECT:/");
    const exit = await logout(request({}, "logout"));
    expect(exit.status).toBe(303);
    expect(exit.headers.get("location")).toBe("/login");
    expect(state.set.mock.lastCall?.[2]).toMatchObject({ maxAge: 0, httpOnly: true, path: "/" });
    expect(await getSession()).toBeNull();
    await expect(Home()).rejects.toThrow("REDIRECT:/login");
    expect(state.dbRead).toHaveBeenCalledTimes(2);
  });
  it("clears logout cookie even with missing configuration", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect((await logout(request({}, "logout"))).status).toBe(303);
    expect(state.set).toHaveBeenCalled();
  });
  it("denies every protected boundary before body parsing or DB/OpenAI work", async () => {
    await expect(Home()).rejects.toThrow("REDIRECT:/login");
    for (const handler of [chat, finalize]) {
      const input = new Request("http://app.test/api/ai", { method: "POST", body: "{" });
      const read = vi.spyOn(input, "json");
      expect((await handler(input)).status).toBe(401);
      expect(read).not.toHaveBeenCalled();
    }
    await expect(moveObjectToStatus("id", "invalid")).rejects.toThrow("Unauthorized");
    await expect(setChecklistItemCompleted("id", true)).rejects.toThrow("Unauthorized");
    for (const call of [state.dbRead, state.create, state.status, state.checklist, state.openai]) expect(call).not.toHaveBeenCalled();
  });
  it("keeps authenticated manual operations working", async () => {
    await createSession();
    await moveObjectToStatus("id", "doing");
    await setChecklistItemCompleted("item", true);
    expect(state.status).toHaveBeenCalledWith("id", "doing");
    expect(state.checklist).toHaveBeenCalledWith("item", true);
    expect(state.openai).not.toHaveBeenCalled();
  });
  it("supports preserved proxy Host and rejects explicitly cross-site requests", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isSameOrigin(new Request("http://internal:3000/api/auth/login", { headers: { host: "personal.example", origin: "https://personal.example" } }))).toBe(true);
    expect(isSameOrigin(new Request("http://app.test", { headers: { "sec-fetch-site": "cross-site" } }))).toBe(false);
  });
});
