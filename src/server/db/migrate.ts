import { migrate } from "drizzle-orm/libsql/migrator";

import type { Database } from "./client";

/**
 * Applies all pending migrations from the `drizzle` folder.
 *
 * Migrations are generated with `npm run db:generate` and committed, so
 * local development and production apply the exact same ordered SQL.
 */
export async function runMigrations(db: Database, migrationsFolder = "drizzle"): Promise<void> {
  await migrate(db, { migrationsFolder });
}
