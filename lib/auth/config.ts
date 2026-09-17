import "server-only";

export class AuthConfigError extends Error {
  constructor() {
    super("Authentication configuration is invalid.");
    this.name = "AuthConfigError";
  }
}

// Validate on requests, never at module load/build time. Never log values.
export function getAuthConfig() {
  const username = process.env.AUTH_USERNAME;
  const passwordHash = process.env.AUTH_PASSWORD_HASH;
  const secret = process.env.AUTH_SECRET;
  const days = process.env.AUTH_SESSION_DAYS ?? "30";
  if (
    !username?.trim() || username.length > 200 ||
    !passwordHash || !/^\$2[ab]\$12\$[./A-Za-z0-9]{53}$/.test(passwordHash) ||
    !secret?.trim() || Buffer.byteLength(secret, "utf8") < 32 ||
    !/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 365
  ) {
    throw new AuthConfigError();
  }
  return { username, passwordHash, secret, sessionDays: Number(days) };
}
