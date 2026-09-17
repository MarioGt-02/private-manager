import { afterAll, describe, expect, it, vi } from "vitest";
import { loadEnvConfig } from "@next/env";
import postgres from "postgres";
vi.mock("server-only", () => ({}));
import { getObjectUpdates } from "@/lib/db/activity";

// Explicit opt-in: reads existing local history only; never creates or edits data.
const enabled = process.env.RUN_ACTIVITY_DB_READ === "1";
let client: ReturnType<typeof postgres> | undefined;
afterAll(async () => { if (client) await client.end({ timeout: 1 }); });
describe.skipIf(!enabled)("Activity local PostgreSQL read acceptance", () => {
  it("matches the latest persisted 30 entries and isolates selected Objects", async () => {
    loadEnvConfig(process.cwd());
    if (!process.env.DATABASE_URL) throw new Error("Local database is not configured.");
    try {
      client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 3 });
    (globalThis as unknown as { dbClient: typeof client }).dbClient = client;
      const objects = await client`select id from objects order by created_at limit 2`;
      if (!objects.length) throw new Error("No existing Objects for runtime acceptance.");
      let checked = 0;
      for (const object of objects) {
        const updates = await getObjectUpdates(object.id);
        const persisted = await client`select id from object_updates where object_id = ${object.id} order by created_at desc, id desc limit 30`;
        expect(updates !== null).toBe(true);
        expect(updates?.every((row) => row.objectId === object.id)).toBe(true);
        expect(updates?.length).toBe(persisted.length);
        expect(updates?.every((row, index) => row.id === persisted[index].id)).toBe(true);
        checked += updates?.length ?? 0;
      }
      console.log(`Activity read acceptance: ${objects.length} Objects, ${checked} persisted rows; zero writes and zero AI requests.`);
    } catch {
      throw new Error("Local Activity database acceptance failed; configuration, connectivity or assertions need checking.");
    }
  }, 15000);
});
