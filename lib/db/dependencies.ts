import "server-only";
import { and, asc, eq, ilike, isNull, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./index";
import { objects, objectDependencies, objectUpdates } from "./schema";
import type { ObjectStatus } from "@/lib/types/object";

export interface DependencyEntry {
  objectId: string;
  title: string;
  status: ObjectStatus;
  /** Derived, never stored: resolved when the dependency Object is Done. */
  resolved: boolean;
}

export interface ObjectDependencies {
  blockedBy: DependencyEntry[];
  blocking: DependencyEntry[];
}

export type DependencyErrorCode =
  | "SELF_DEPENDENCY"
  | "DUPLICATE_DEPENDENCY"
  | "CIRCULAR_DEPENDENCY"
  | "OBJECT_NOT_FOUND"
  | "DEPENDENCY_NOT_FOUND"
  | "DEPENDENCY_ARCHIVED"
  | "DEPENDENCY_NOT_EXISTS";

export class DependencyError extends Error {
  constructor(public readonly code: DependencyErrorCode) {
    super(code);
    this.name = "DependencyError";
  }
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

type Graph = { forward: Map<string, string[]>; reverse: Map<string, string[]> };

async function loadGraph(queryable: Queryable): Promise<Graph> {
  const rows = await queryable.select().from(objectDependencies);
  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  for (const row of rows) {
    const f = forward.get(row.objectId) ?? [];
    f.push(row.dependsOnObjectId);
    forward.set(row.objectId, f);
    const r = reverse.get(row.dependsOnObjectId) ?? [];
    r.push(row.objectId);
    reverse.set(row.dependsOnObjectId, r);
  }
  return { forward, reverse };
}

/** All Objects that directly or transitively depend on `objectId`. */
function transitiveDependents(objectId: string, reverse: Map<string, string[]>): Set<string> {
  const dependents = new Set<string>();
  const visited = new Set<string>([objectId]);
  const queue = [objectId];
  while (queue.length) {
    const current = queue.pop()!;
    for (const dependent of reverse.get(current) ?? []) {
      if (!visited.has(dependent)) {
        visited.add(dependent);
        dependents.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return dependents;
}

function toEntry(row: { id: string; title: string; status: ObjectStatus }): DependencyEntry {
  return { objectId: row.id, title: row.title, status: row.status, resolved: row.status === "done" };
}

export async function getDependencies(objectId: string): Promise<ObjectDependencies> {
  const db = getDb();
  const [blockedByRows, blockingRows] = await Promise.all([
    db
      .select({ id: objects.id, title: objects.title, status: objects.status })
      .from(objectDependencies)
      .innerJoin(objects, eq(objectDependencies.dependsOnObjectId, objects.id))
      .where(eq(objectDependencies.objectId, objectId))
      .orderBy(asc(objects.title)),
    db
      .select({ id: objects.id, title: objects.title, status: objects.status })
      .from(objectDependencies)
      .innerJoin(objects, eq(objectDependencies.objectId, objects.id))
      .where(eq(objectDependencies.dependsOnObjectId, objectId))
      .orderBy(asc(objects.title)),
  ]);
  return {
    blockedBy: blockedByRows.map(toEntry),
    blocking: blockingRows.map(toEntry),
  };
}

export async function addDependency(objectId: string, dependsOnObjectId: string): Promise<ObjectDependencies> {
  const db = getDb();
  await db.transaction(async (tx) => {
    if (objectId === dependsOnObjectId) throw new DependencyError("SELF_DEPENDENCY");

    const [current] = await tx.select({ id: objects.id }).from(objects).where(eq(objects.id, objectId)).for("share");
    if (!current) throw new DependencyError("OBJECT_NOT_FOUND");

    const [target] = await tx
      .select({ id: objects.id, title: objects.title, archivedAt: objects.archivedAt })
      .from(objects)
      .where(eq(objects.id, dependsOnObjectId))
      .for("share");
    if (!target) throw new DependencyError("DEPENDENCY_NOT_FOUND");
    if (target.archivedAt) throw new DependencyError("DEPENDENCY_ARCHIVED");

    const [existing] = await tx
      .select({ objectId: objectDependencies.objectId })
      .from(objectDependencies)
      .where(and(eq(objectDependencies.objectId, objectId), eq(objectDependencies.dependsOnObjectId, dependsOnObjectId)))
      .limit(1);
    if (existing) return; // idempotent: already depends on this Object

    const { reverse } = await loadGraph(tx);
    if (transitiveDependents(objectId, reverse).has(dependsOnObjectId)) {
      throw new DependencyError("CIRCULAR_DEPENDENCY");
    }

    await tx.insert(objectDependencies).values({ objectId, dependsOnObjectId });
    await tx.insert(objectUpdates).values({
      id: randomUUID(),
      objectId,
      type: "dependency_added",
      content: `Added dependency on ${target.title}`,
    });
  });
  return getDependencies(objectId);
}

export async function removeDependency(objectId: string, dependsOnObjectId: string): Promise<ObjectDependencies> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [target] = await tx.select({ title: objects.title }).from(objects).where(eq(objects.id, dependsOnObjectId)).for("share");
    const removed = await tx
      .delete(objectDependencies)
      .where(and(eq(objectDependencies.objectId, objectId), eq(objectDependencies.dependsOnObjectId, dependsOnObjectId)))
      .returning({ objectId: objectDependencies.objectId });
    if (!removed.length) throw new DependencyError("DEPENDENCY_NOT_EXISTS");
    await tx.insert(objectUpdates).values({
      id: randomUUID(),
      objectId,
      type: "dependency_removed",
      content: `Removed dependency on ${target?.title ?? "an Object"}`,
    });
  });
  return getDependencies(objectId);
}

export async function searchDependencyCandidates(objectId: string, query: string): Promise<DependencyEntry[]> {
  const term = query.trim();
  if (!term) return [];
  const db = getDb();
  const { forward, reverse } = await loadGraph(db);
  const blockedIds = new Set(forward.get(objectId) ?? []);
  const cycleIds = transitiveDependents(objectId, reverse);
  const rows = await db
    .select({ id: objects.id, title: objects.title, status: objects.status })
    .from(objects)
    .where(and(isNull(objects.archivedAt), ne(objects.id, objectId), ilike(objects.title, `%${term}%`)))
    .orderBy(asc(objects.title))
    .limit(20);
  return rows
    .filter((row) => !blockedIds.has(row.id) && !cycleIds.has(row.id))
    .map(toEntry);
}

