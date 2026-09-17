// Integration test against its own Compose project/volume, never the user's DB.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import bcrypt from "bcryptjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const project = `pm-deploy-test-${randomBytes(4).toString("hex")}`;
const directory = await mkdtemp(path.join(tmpdir(), "pm-deploy-"));
const envFile = path.join(directory, ".env");
const password = randomBytes(24).toString("hex");
const secret = randomBytes(32).toString("hex");
const passwordHash = await bcrypt.hash(password, 12);
const listener = createServer();
await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
await writeFile(envFile, `POSTGRES_DB=private_manager\nPOSTGRES_USER=postgres\nPOSTGRES_PASSWORD='${randomBytes(24).toString("hex")}@$'\nAUTH_USERNAME=deployment-test\nAUTH_PASSWORD_HASH='${passwordHash}'\nAUTH_SECRET='${secret}'\nAUTH_COOKIE_SECURE=false\nAPP_BIND_IP=127.0.0.1\nAPP_PORT=${port}\n`, { mode: 0o600 });
const args = ["compose", "--env-file", envFile, "-p", project, "-f", "docker-compose.yml"];
function docker(commands, input) {
  const result = spawnSync("docker", [...args, ...commands], { encoding: "utf8", input, windowsHide: true, env: { ...process.env, COMPOSE_BAKE: "false" }, maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) {
    // Commands never include credentials. Redact runtime values defensively.
    let diagnostic = `${result.stdout || ""}\n${result.stderr || result.error?.message || ""}`.slice(-12000);
    for (const value of [password, passwordHash, secret]) diagnostic = diagnostic.replaceAll(value, "[redacted]");
    throw new Error(`${commands.join(" ")} failed:\n${diagnostic}`);
  }
  return result.stdout.trim();
}
const base = `http://127.0.0.1:${port}`;
async function healthy() {
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("Application did not become healthy");
}
function sql(statement) { return docker(["exec", "-T", "db", "psql", "-U", "postgres", "-d", "private_manager", "-v", "ON_ERROR_STOP=1", "-At"], statement); }
let browser;
try {
  docker(["config", "--quiet"]); console.log("Compose config valid.");
  console.log("Building production app and migration images...");
  docker(["--profile", "tools", "build", "app", "migrate"]); console.log("Both images built.");
  docker(["up", "-d", "--wait", "db"]);
  docker(["--profile", "tools", "run", "--rm", "migrate"]);
  sql("INSERT INTO objects(id,title,status,archived_at,cancelled_at) VALUES ('deploy-live','Deployment live Object','doing',NULL,NULL), ('deploy-done','Deployment archived Done','done',now(),NULL), ('deploy-cancel','Deployment cancelled Ready','ready',now(),now()); INSERT INTO checklist_items(id,object_id,title,position) VALUES ('deploy-check','deploy-live','Verify NAS setup',0); INSERT INTO object_updates(id,object_id,type,content) VALUES ('deploy-event','deploy-live','object_created','Deployment test fixture.');");
  const snapshot = sql("SELECT md5(string_agg(row_to_json(o)::text, '' ORDER BY id)) FROM objects o; SELECT count(*) FROM checklist_items; SELECT count(*) FROM object_updates; SELECT count(*) FROM drizzle.__drizzle_migrations;");
  docker(["--profile", "tools", "run", "--rm", "migrate"]);
  assert.equal(sql("SELECT md5(string_agg(row_to_json(o)::text, '' ORDER BY id)) FROM objects o; SELECT count(*) FROM checklist_items; SELECT count(*) FROM object_updates; SELECT count(*) FROM drizzle.__drizzle_migrations;"), snapshot);
  docker(["up", "-d", "--wait", "app"]); await healthy();
  const dbContainer = docker(["ps", "-q", "db"]);
  const inspection = spawnSync("docker", ["inspect", "--format", "{{json .HostConfig.PortBindings}}", dbContainer], { encoding: "utf8", windowsHide: true });
  assert.equal(inspection.status, 0);
  assert.equal(Object.keys(JSON.parse(inspection.stdout.trim()) ?? {}).length, 0, "No database host port bindings");
  assert.equal((await fetch(base, { redirect: "manual" })).headers.get("location"), "/login");
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "deployment-test", password }) });
  assert.equal(login.status, 200); assert.doesNotMatch(login.headers.get("set-cookie"), /; Secure/i);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let aiCalls = 0; page.on("request", request => { if (request.url().includes("/api/ai/")) aiCalls++; });
  await page.goto(`${base}/login`);
  await page.getByLabel("Username", { exact: true }).fill("deployment-test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("button", { name: "Open Object: Deployment live Object", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Open Object: Deployment (archived|cancelled)/ }).count(), 0);
  await page.getByRole("button", { name: "Archived Done Objects" }).click();
  const done = page.getByRole("dialog", { name: "Archived — Done" });
  await done.getByText("Deployment archived Done", { exact: true }).waitFor();
  await done.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Archived Ready Objects" }).click();
  const ready = page.getByRole("dialog", { name: "Archived — Ready" });
  await ready.getByRole("button", { name: "Cancelled", exact: true }).click();
  const cancelled = ready.getByText("Deployment cancelled Ready", { exact: true }); await cancelled.waitFor();
  assert.match(await cancelled.getAttribute("class"), /line-through/);
  await ready.getByRole("button", { name: "Close", exact: true }).click();
  console.log("Real HTTP browser login, Board, archived Done and cancelled Ready passed.");
  docker(["restart", "db", "app"]); await healthy();
  assert.equal(sql("SELECT md5(string_agg(row_to_json(o)::text, '' ORDER BY id)) FROM objects o; SELECT count(*) FROM checklist_items; SELECT count(*) FROM object_updates; SELECT count(*) FROM drizzle.__drizzle_migrations;"), snapshot);
  await page.reload(); await page.getByRole("button", { name: "Open Object: Deployment live Object" }).waitFor();
  // Recreate containers (without deleting volume) to prove storage is external.
  docker(["down"]); docker(["up", "-d", "--wait"]); await healthy();
  assert.equal(sql("SELECT md5(string_agg(row_to_json(o)::text, '' ORDER BY id)) FROM objects o; SELECT count(*) FROM checklist_items; SELECT count(*) FROM object_updates; SELECT count(*) FROM drizzle.__drizzle_migrations;"), snapshot);
  assert.equal(aiCalls, 0);
  console.log("Persistence after restart AND container recreation passed. Migration rerun unchanged. Zero OpenAI calls; user DB untouched.");
} finally {
  if (browser) await browser.close();
  // Only this randomly named, test-owned project and its test-owned volume.
  try { docker(["down", "--volumes"]); } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("pm-deploy-"));
    await rm(directory, { recursive: true, force: true });
  }
}
