// Run after npm run build. Uses temporary credentials and no external services.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";

const password = randomBytes(18).toString("hex");
const secret = randomBytes(32).toString("hex");
const hash = await bcrypt.hash(password, 12);
const baseEnv = {
  ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
  // This test supplies all runtime configuration. Prevent local .env expansion
  // from rewriting the temporary bcrypt hash or loading external service keys.
  __NEXT_PROCESSED_ENV: "true",
  DATABASE_URL: "", OPENAI_API_KEY: "", OPENAI_MODEL: "",
  AUTH_USERNAME: "smoke-user", AUTH_PASSWORD_HASH: hash, AUTH_SECRET: secret, AUTH_SESSION_DAYS: "30",
};

async function withApp(env, check) {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env, stdio: "ignore", windowsHide: true,
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error("Smoke server exited before readiness.");
      try {
        const response = await fetch(`${base}/login`, { signal: AbortSignal.timeout(1000) });
        if (response.status === 200) { ready = true; break; }
      } catch { /* Wait for local server startup. */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(ready, "Local server becomes ready");
    await check(base);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill(); await exited;
    }
  }
}

async function get(base, path, cookie) {
  return fetch(`${base}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
}
async function post(base, path, body, cookie) {
  return fetch(`${base}${path}`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

await withApp(baseEnv, async (base) => {
  assert.equal((await get(base, "/")).headers.get("location"), "/login");
  const page = await get(base, "/login");
  assert.match(await page.text(), /Username/);
  for (const path of ["chat", "finalize"]) {
    assert.equal((await post(base, `/api/ai/create-object/${path}`, {})).status, 401);
  }
  const bad = await post(base, "/api/auth/login", { username: "wrong", password });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get("set-cookie"), null);
  const valid = await post(base, "/api/auth/login", { username: "smoke-user", password });
  assert.equal(valid.status, 200);
  const setCookie = valid.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=lax/i);
  const cookie = setCookie.split(";")[0];
  // Explicit Cookie header tests the server over local HTTP; a real production
  // browser requires HTTPS to send this Secure cookie.
  for (let refresh = 0; refresh < 2; refresh++) {
    const board = await get(base, "/", cookie);
    assert.equal(board.status, 200);
    assert.match(await board.text(), /Could not load objects from the database/);
  }
  assert.equal((await get(base, "/login", cookie)).headers.get("location"), "/");
  assert.equal((await get(base, "/", `${cookie.slice(0, -15)}tampered`)).headers.get("location"), "/login");
  const now = Math.floor(Date.now() / 1000);
  const expired = await new SignJWT({ authenticated: true, username: "smoke-user" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuedAt(now - 100).setExpirationTime(now - 1)
    .sign(new TextEncoder().encode(secret));
  assert.equal((await get(base, "/", `private_manager_session=${expired}`)).headers.get("location"), "/login");
  const exit = await post(base, "/api/auth/logout", {}, cookie);
  assert.equal(exit.status, 303);
  assert.equal(exit.headers.get("location"), "/login");
  assert.match(exit.headers.get("set-cookie"), /Max-Age=0/i);
  assert.equal((await get(base, "/")).headers.get("location"), "/login");
});

await withApp({ ...baseEnv, AUTH_USERNAME: "", AUTH_PASSWORD_HASH: "", AUTH_SECRET: "" }, async (base) => {
  assert.equal((await get(base, "/")).headers.get("location"), "/login");
  const result = await post(base, "/api/auth/login", { username: "smoke-user", password });
  assert.equal(result.status, 500);
  assert.equal((await result.json()).error.code, "AUTH_CONFIG_ERROR");
  assert.equal((await post(base, "/api/auth/logout", {})).status, 303);
});
console.log("HTTP auth smoke passed: login, refresh, logout, protected APIs, tampered/expired cookies, missing config; no DB/OpenAI.");
