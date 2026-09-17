import "server-only";
import { getSession } from "./session";

export class UnauthorizedError extends Error {
  constructor() { super("Unauthorized"); this.name = "UnauthorizedError"; }
}

export async function requireAuth() {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}
