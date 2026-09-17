// Construct the internal connection string at runtime; never bake credentials.
export function configureDatabase(env = process.env) {
  if (env.DATABASE_URL) return;
  const { POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = env;
  if (!POSTGRES_HOST || !POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) {
    throw new Error("Database environment is incomplete.");
  }
  env.DATABASE_URL = `postgresql://${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD)}@${POSTGRES_HOST}:5432/${encodeURIComponent(POSTGRES_DB)}`;
}
