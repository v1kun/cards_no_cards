import "server-only";

import { env } from "@/lib/env";
import { createDatabase, type Database } from "./client";

/**
 * Process-wide database singleton for the running application.
 *
 * Route handlers and services call {@link getDb} instead of constructing a
 * client per request, so a single libSQL connection (with foreign keys
 * enabled) is reused. Tests do NOT use this; they build isolated databases
 * via the integration helpers.
 */
let instance: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!instance) {
    instance = createDatabase(env.DATABASE_URL).then(({ db }) => db);
  }
  return instance;
}
