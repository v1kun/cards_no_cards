import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SECRET_FILE = "local-data/session-secret";
let cached: string | null = null;

/**
 * Session signing secret: `SESSION_SECRET` when set, otherwise a random
 * secret generated once and kept in `local-data/` (git-ignored), so
 * sessions survive restarts without manual configuration.
 */
export function sessionSecret(configured: string | undefined): string {
  if (configured) return configured;
  if (cached) return cached;
  if (existsSync(SECRET_FILE)) {
    cached = readFileSync(SECRET_FILE, "utf8").trim();
  } else {
    cached = randomBytes(32).toString("hex");
    mkdirSync(dirname(SECRET_FILE), { recursive: true });
    writeFileSync(SECRET_FILE, cached, { mode: 0o600 });
  }
  return cached;
}
