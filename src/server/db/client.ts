import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import { schema } from "./schema";

export type Database = LibSQLDatabase<typeof schema>;

/** A transaction handle, as passed to `db.transaction(async (tx) => ...)`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Anything that can run queries: the database or an open transaction. */
export type DbExecutor = Database | Transaction;

/**
 * Creates a Drizzle database bound to a libSQL client.
 *
 * `url` uses libSQL conventions, e.g. `file:./local-data/cards.sqlite`
 * or `file::memory:` for tests. Foreign-key enforcement is enabled on
 * every connection because SQLite leaves it off by default.
 */
export async function createDatabase(url: string): Promise<{ db: Database; client: Client }> {
  const client = createClient({ url });
  await client.execute("PRAGMA foreign_keys = ON;");
  const db = drizzle(client, { schema });
  return { db, client };
}
