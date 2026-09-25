import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";
import { addInterval, today } from "@/lib/recurrence/calc";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mocks = vi.hoisted(() => ({ auth: vi.fn(), openai: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/index", () => ({ getDb: () => db }));
vi.mock("@/lib/auth/require-auth", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: mocks.openai }));

import { createObject, getObject, getObjects, updateObjectRecurrence, updateObjectStatus, updateOccurrenceNote } from "@/lib/db/queries";
import { addDependency } from "@/lib/db/dependencies";

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
  return createObject({ title, status, goal: "goal", currentState: "current", nextAction: "first step", checklist: [{ title: "Step A", completed: true, children: [] }, { title: "Step B", completed: false, children: [] }] });
}

describe("addInterval", () => {
  it("daily / weekly / monthly / yearly", () => {
    expect(addInterval("2026-09-28", "daily", 1)).toBe("2026-09-29");
    expect(addInterval("2026-09-28", "weekly", 1)).toBe("2026-10-05");
    expect(addInterval("2026-09-28", "monthly", 1)).toBe("2026-10-28");
    expect(addInterval("2026-09-28", "yearly", 1)).toBe("2027-09-28");
  });

  it("interval > 1", () => {
    expect(addInterval("2026-09-28", "weekly", 2)).toBe("2026-10-12");
    expect(addInterval("2026-09-28", "monthly", 3)).toBe("2026-12-28");
    expect(addInterval("2026-09-28", "yearly", 2)).toBe("2028-09-28");
  });

  it("monthly clamps to end of month", () => {
    expect(addInterval("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(addInterval("2024-01-31", "monthly", 1)).toBe("2024-02-29");
  });

  it("yearly clamps Feb 29 in non-leap years", () => {
    expect(addInterval("2024-02-29", "yearly", 1)).toBe("2025-02-28");
  });
});

describe("Recurring Objects", () => {
  it("normal Object stays non-recurring when completed", async () => {
    const a = await make("A");
    await updateObjectStatus(a.id, "done");
    const objects = await getObjects();
    expect(objects).toHaveLength(1);
    expect(objects[0].recurrence).toBeNull();
  });

  it("completing a recurring Object creates exactly one new occurrence and keeps the old one Done", async () => {
    const a = await make("Car wash");
    await updateObjectRecurrence(a.id, { frequency: "monthly", interval: 1, basis: "completion_date", nextDate: null });
    await updateObjectStatus(a.id, "done");

    const objects = await getObjects();
    expect(objects).toHaveLength(2);

    const done = objects.find((o) => o.id === a.id)!;
    const next = objects.find((o) => o.id !== a.id)!;
    expect(done.status).toBe("done");
    expect(next.status).toBe("idea");
    expect(next.recurrence?.seriesId).toBe(a.id);
    expect(next.recurrence?.previousOccurrenceId).toBe(a.id);
    expect(done.recurrence?.nextOccurrenceId).toBe(next.id);
  });

  it("duplicate completion is idempotent", async () => {
    const a = await make("A");
    await updateObjectRecurrence(a.id, { frequency: "weekly", interval: 1, basis: "completion_date", nextDate: null });
    await updateObjectStatus(a.id, "done");
    await updateObjectStatus(a.id, "done");
    expect(await getObjects()).toHaveLength(2);
  });

  it("copies title/goal/checklist structure, resets completion, and derives Next Action", async () => {
    const a = await make("Service");
    await updateObjectRecurrence(a.id, { frequency: "monthly", interval: 2, basis: "completion_date", nextDate: null });
    await updateObjectStatus(a.id, "done");

    const next = (await getObjects()).find((o) => o.id !== a.id)!;
    expect(next.title).toBe("Service");
    expect(next.goal).toBe("goal");
    expect(next.currentState).toBe("");
    expect(next.occurrenceNote).toBeNull();
    expect(next.checklist.map((i) => i.title)).toEqual(["Step A", "Step B"]);
    expect(next.checklist.every((i) => i.completed === false)).toBe(true);
    expect(next.nextAction).toBe("Step A");
    expect(next.recurrence?.interval).toBe(2);
    expect(next.recurrence?.frequency).toBe("monthly");
  });

  it("scheduled-date basis calculates from the scheduled date, not completion date", async () => {
    const a = await make("Bollo");
    await updateObjectRecurrence(a.id, { frequency: "yearly", interval: 1, basis: "scheduled_date", nextDate: "2026-10-31" });
    await updateObjectStatus(a.id, "done");
    const next = (await getObjects()).find((o) => o.id !== a.id)!;
    expect(next.recurrence?.nextDate).toBe("2027-10-31");
  });

  it("completion-date basis calculates from the completion date", async () => {
    const a = await make("Car wash");
    await updateObjectRecurrence(a.id, { frequency: "monthly", interval: 1, basis: "completion_date", nextDate: null });
    await updateObjectStatus(a.id, "done");
    const next = (await getObjects()).find((o) => o.id !== a.id)!;
    const expected = addInterval(new Date().toISOString().slice(0, 10), "monthly", 1);
    expect(next.recurrence?.nextDate).toBe(expected);
  });

  it("stores the next occurrence date on the completed occurrence", async () => {
    const scheduled = await make("Bollo");
    await updateObjectRecurrence(scheduled.id, { frequency: "yearly", interval: 1, basis: "scheduled_date", nextDate: "2026-10-31" });
    await updateObjectStatus(scheduled.id, "done");
    expect((await getObject(scheduled.id))!.recurrence?.nextDate).toBe("2027-10-31");

    const completion = await make("Car wash");
    await updateObjectRecurrence(completion.id, { frequency: "monthly", interval: 1, basis: "completion_date", nextDate: null });
    await updateObjectStatus(completion.id, "done");
    const expected = addInterval(today(), "monthly", 1);
    expect((await getObject(completion.id))!.recurrence?.nextDate).toBe(expected);
  });

  it("does not copy dependencies to the next occurrence", async () => {
    const a = await make("A");
    const x = await make("X");
    await addDependency(a.id, x.id);
    await updateObjectRecurrence(a.id, { frequency: "monthly", interval: 1, basis: "completion_date", nextDate: null });
    await updateObjectStatus(a.id, "done");
    const next = (await getObject((await getObjects()).find((o) => o.id !== a.id)!.id))!;
    expect(next.unresolvedDependencies).toBe(0);
  });

  it("disabling recurrence prevents future generation", async () => {
    const a = await make("A");
    await updateObjectRecurrence(a.id, { frequency: "monthly", interval: 1, basis: "completion_date", nextDate: null });
    await updateObjectRecurrence(a.id, null);
    await updateObjectStatus(a.id, "done");
    expect(await getObjects()).toHaveLength(1);
  });

  it("occurrence note persists on the correct occurrence and is not copied", async () => {
    const a = await make("Tagliando");
    await updateOccurrenceNote(a.id, "Mileage 86,420 km, oil + filter");
    await updateObjectRecurrence(a.id, { frequency: "yearly", interval: 1, basis: "completion_date", nextDate: null });
    await updateObjectStatus(a.id, "done");

    const done = (await getObject(a.id))!;
    const next = (await getObjects()).find((o) => o.id !== a.id)!;
    expect(done.occurrenceNote).toBe("Mileage 86,420 km, oil + filter");
    expect(next.occurrenceNote).toBeNull();
  });
});
