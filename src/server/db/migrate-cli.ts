import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { env } from "@/lib/env";
import { createDatabase } from "./client";
import { runMigrations } from "./migrate";

/**
 * Standalone migration entrypoint: `npm run db:migrate`.
 *
 * Applies all committed migrations to the database referenced by
 * `DATABASE_URL`. Safe to run repeatably; already-applied migrations are
 * skipped by the migrator's bookkeeping table.
 */
async function main() {
  // libSQL will create the database file but not missing parent dirs.
  if (env.DATABASE_URL.startsWith("file:")) {
    const filePath = env.DATABASE_URL.slice("file:".length);
    const dir = dirname(filePath);
    if (dir && dir !== ".") {
      await mkdir(dir, { recursive: true });
    }
  }

  const { db, client } = await createDatabase(env.DATABASE_URL);
  try {
    await runMigrations(db);
    console.log(`Migrations applied to ${env.DATABASE_URL}`);
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
