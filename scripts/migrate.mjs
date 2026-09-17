import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { configureDatabase } from "./container-env.mjs";

let client;
try {
  configureDatabase();
  client = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  // Single session lock prevents two deployment operators migrating concurrently.
  const [lock] = await client`select pg_try_advisory_lock(119337, 11) as acquired`;
  if (!lock.acquired) throw new Error("Migration already running.");
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("Database migrations complete.");
} catch {
  console.error("Migration failed. Check database availability and migration state before retrying; no credentials logged.");
  process.exitCode = 1;
} finally {
  // Closing the session also releases the advisory lock.
  if (client) await client.end({ timeout: 5 });
}
