import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDatabase, type Database } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

/**
 * Creates a fresh, isolated database with all migrations applied.
 *
 * A unique temp file is used (not `:memory:`) because libSQL opens a new
 * connection per statement for in-memory URLs, which would discard the
 * migrated schema. `close()` disposes the connection and deletes the file.
 */
export async function createTestDatabase(): Promise<{
  db: Database;
  close: () => void;
}> {
  const dir = mkdtempSync(join(tmpdir(), "cnc-test-"));
  const file = join(dir, "test.sqlite");
  const { db, client } = await createDatabase(`file:${file}`);
  await runMigrations(db);
  return {
    db,
    close: () => {
      client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let userCounter = 0;

/** Returns a stable, unique synthetic user id for tests. */
export function makeUserId(label = "user"): string {
  userCounter += 1;
  return `${label}-${userCounter}`;
}
