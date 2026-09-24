import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mocks = vi.hoisted(() => ({ auth: vi.fn(), openai: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/index", () => ({ getDb: () => db }));
vi.mock("@/lib/auth/require-auth", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: mocks.openai }));

import { createObject, getObject } from "@/lib/db/queries";
import { addDependency, DependencyError, getDependencies, removeDependency, searchDependencyCandidates } from "@/lib/db/dependencies";

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  for (const migration of ["0000_flaky_meggan", "0001_object_archive_metadata", "0002_object_category_presentation", "0003_silent_groot", "0004_keen_diamondback", "0005_boring_quicksilver", "0006_faulty_meteorite", "0007_clever_annihilus","0008_silky_slapstick","0009_loose_skin"]) {
    await pg.exec(await readFile(`drizzle/${migration}.sql`, "utf8"));
  }
}, 30000);

beforeEach(async () => { await pg.exec("TRUNCATE objects CASCADE"); });
afterAll(async () => { await pg.close(); });

async function make(title: string, status: schema.ObjectStatus = "doing") {
  return createObject({ title, status, goal: "goal", currentState: "current", nextAction: "next" });
}

describe("Object dependencies", () => {
  it("creates A -> B and derives both directions", async () => {
    const a = await make("A");
    const b = await make("B");
    const deps = await addDependency(a.id, b.id);
    expect(deps.blockedBy.map((entry) => entry.objectId)).toEqual([b.id]);
    expect(deps.blocking).toEqual([]);

    const bDeps = await getDependencies(b.id);
    expect(bDeps.blocking.map((entry) => entry.objectId)).toEqual([a.id]);
    expect(bDeps.blockedBy).toEqual([]);
  });

  it("rejects self dependency", async () => {
    const a = await make("A");
    await expect(addDependency(a.id, a.id)).rejects.toBeInstanceOf(DependencyError);
    await expect(addDependency(a.id, a.id)).rejects.toThrow("SELF_DEPENDENCY");
  });

  it("treats duplicate A -> B idempotently", async () => {
    const a = await make("A");
    const b = await make("B");
    await addDependency(a.id, b.id);
    const again = await addDependency(a.id, b.id);
    expect(again.blockedBy).toHaveLength(1);
  });

  it("rejects direct two-node cycle A -> B then B -> A", async () => {
    const a = await make("A");
    const b = await make("B");
    await addDependency(a.id, b.id);
    await expect(addDependency(b.id, a.id)).rejects.toThrow("CIRCULAR_DEPENDENCY");
  });

  it("rejects longer cycle A -> B -> C then C -> A", async () => {
    const a = await make("A");
    const b = await make("B");
    const c = await make("C");
    await addDependency(a.id, b.id);
    await addDependency(b.id, c.id);
    await expect(addDependency(c.id, a.id)).rejects.toThrow("CIRCULAR_DEPENDENCY");
  });

  it("removes a dependency without deleting Objects", async () => {
    const a = await make("A");
    const b = await make("B");
    await addDependency(a.id, b.id);
    const deps = await removeDependency(a.id, b.id);
    expect(deps.blockedBy).toEqual([]);

    const [aRow] = await db.select().from(schema.objects).where(eq(schema.objects.id, a.id));
    const [bRow] = await db.select().from(schema.objects).where(eq(schema.objects.id, b.id));
    expect(aRow).toBeTruthy();
    expect(bRow).toBeTruthy();
  });

  it("marks a Done dependency resolved and moving it out makes it unresolved again", async () => {
    const a = await make("A");
    const b = await make("B", "doing");
    await addDependency(a.id, b.id);
    expect((await getDependencies(a.id)).blockedBy[0].resolved).toBe(false);

    await db.update(schema.objects).set({ status: "done" }).where(eq(schema.objects.id, b.id));
    expect((await getDependencies(a.id)).blockedBy[0].resolved).toBe(true);

    await db.update(schema.objects).set({ status: "doing" }).where(eq(schema.objects.id, b.id));
    expect((await getDependencies(a.id)).blockedBy[0].resolved).toBe(false);
  });

  it("does not modify status or Next Action", async () => {
    const a = await make("A");
    const b = await make("B");
    const before = await getObject(a.id);
    await addDependency(a.id, b.id);
    await removeDependency(a.id, b.id);
    const after = await getObject(a.id);
    expect(after!.status).toBe(before!.status);
    expect(after!.nextAction).toBe(before!.nextAction);
    expect(after!.currentState).toBe(before!.currentState);
  });

  it("search excludes self, already-attached, archived and cycle-forming Objects", async () => {
    const a = await make("A");
    const b = await make("B");
    const c = await make("C");
    await addDependency(a.id, b.id);
    await addDependency(c.id, a.id);

    expect(await searchDependencyCandidates(a.id, "")).toEqual([]);

    const bResults = await searchDependencyCandidates(a.id, "B");
    expect(bResults.find((entry) => entry.objectId === b.id)).toBeUndefined();

    const cResults = await searchDependencyCandidates(a.id, "C");
    expect(cResults.find((entry) => entry.objectId === c.id)).toBeUndefined();

    const d = await make("D");
    await db.update(schema.objects).set({ archivedAt: new Date() }).where(eq(schema.objects.id, d.id));
    const dResults = await searchDependencyCandidates(a.id, "D");
    expect(dResults.find((entry) => entry.objectId === d.id)).toBeUndefined();
  });
});
