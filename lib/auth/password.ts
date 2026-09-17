import "server-only";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getAuthConfig } from "./config";

export const loginSchema = z.object({
  username: z.string().min(1).max(200).refine((value) => !!value.trim()),
  password: z.string().min(1).refine((value) => Buffer.byteLength(value, "utf8") <= 72),
}).strict();

// Fixed bcrypt cost-12 dummy hash; never generated during a login request.
export const DUMMY_PASSWORD_HASH = "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";

export async function verifyCredentials(username: string, password: string) {
  const config = getAuthConfig();
  const matchesUsername = username === config.username;
  const matchesPassword = await bcrypt.compare(
    password,
    matchesUsername ? config.passwordHash : DUMMY_PASSWORD_HASH,
  );
  return matchesUsername && matchesPassword;
}
