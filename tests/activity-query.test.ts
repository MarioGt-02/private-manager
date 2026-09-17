import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const mocks = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), openai: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/index", () => ({ getDb: () => mocks }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: mocks.openai }));
import { getObjectUpdates } from "@/lib/db/activity";

const dialect = new PgDialect();
const rows = Array.from({ length: 45 }, (_, i) => ({ id: `event-${i}`, objectId: i % 4 === 0 ? "object-b" : "object-a", type: "object_edited", content: `Entry ${i}`, createdAt: new Date(Date.UTC(2026, 8, 9, 0, i)) }));
let orders: string[];
let requestedLimit: number;
beforeEach(() => {
  vi.resetAllMocks(); orders = []; requestedLimit = 0;
  mocks.select.mockImplementationOnce(() => ({ from: () => ({ where: () => ({ limit: () => [{ id: "object-a" }] }) }) }));
  mocks.select.mockImplementationOnce(() => ({ from: () => ({ where: (condition: SQL) => {
    const query = dialect.sqlToQuery(condition);
    expect(query.sql).toContain('"object_updates"."object_id" =');
    const filtered = rows.filter((row) => row.objectId === query.params[0]);
    return { orderBy: (...clauses: SQL[]) => {
      orders = clauses.map((clause) => dialect.sqlToQuery(clause).sql);
      return { limit: (limit: number) => { requestedLimit = limit; return filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit); } };
    } };
  } }) }));
});

describe("Activity read query", () => {
  it("filters the selected object, orders newest first in SQL, and bounds rows to 30", async () => {
    const result = await getObjectUpdates("object-a");
    expect(orders).toEqual(['"object_updates"."created_at" desc', '"object_updates"."id" desc']);
    expect(requestedLimit).toBe(30);
    expect(result).toHaveLength(30);
    expect(result?.every((row) => row.objectId === "object-a")).toBe(true);
    expect(result?.[0].createdAt).toBe(rows.filter((row) => row.objectId === "object-a").at(-1)?.createdAt.toISOString());
    for (const call of [mocks.insert, mocks.update, mocks.delete, mocks.openai]) expect(call).not.toHaveBeenCalled();
  });
  it("caps caller limits and supports smaller bounded windows", async () => {
    await getObjectUpdates("object-a", 10000);
    expect(requestedLimit).toBe(30);
  });
});
