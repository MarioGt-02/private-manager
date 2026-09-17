import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Server-only database client.
 *
 * The connection is created lazily so that importing this module (for example
 * during the Next.js build) never requires a live database or a configured
 * DATABASE_URL. The client is cached on `globalThis` to avoid creating a new
 * connection pool on every hot reload in development.
 */
const globalForDb = globalThis as unknown as {
  dbClient?: ReturnType<typeof postgres>;
};

function getClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Configure it in .env before connecting to the database.",
    );
  }

  if (!globalForDb.dbClient) {
    globalForDb.dbClient = postgres(process.env.DATABASE_URL, {
      max: 5,
      prepare: false,
    });
  }

  return globalForDb.dbClient;
}

export function getDb() {
  return drizzle(getClient(), { schema });
}
