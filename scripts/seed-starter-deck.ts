import { resolve } from "node:path";

import { env } from "@/lib/env";
import { createDatabase } from "@/server/db/client";
import { exampleContainsLemma } from "@/server/starter-deck/parse";
import { loadStarterDeck, seedStarterDeck } from "@/server/starter-deck/seed";

/**
 * Loads a starter deck into a user's vocabulary:
 * `npm run deck:seed -- [userId] [deck]` (defaults: `dev-user`, `es-a1`).
 * Words the user already has are skipped, so it is safe to re-run.
 */
async function main() {
  const userId = process.argv[2] ?? "dev-user";
  const deck = process.argv[3] ?? "es-a1";
  const dir = resolve(process.cwd(), "data/starter-decks", deck);

  const { entries, issues } = await loadStarterDeck(dir);
  for (const issue of issues) {
    console.error(`${issue.file}:${issue.line}: ${issue.message}`);
  }
  if (issues.length > 0) {
    throw new Error(`${issues.length} invalid row(s) in ${dir}; nothing was written.`);
  }
  const withoutCloze = entries.filter((entry) => !exampleContainsLemma(entry));
  for (const entry of withoutCloze) {
    console.warn(`warning: example for "${entry.lemma}" does not contain the lemma`);
  }

  const { db, client } = await createDatabase(env.DATABASE_URL);
  try {
    const result = await seedStarterDeck(db, userId, entries, `starter-deck:${deck}`);
    console.log(
      `Deck ${deck}: ${entries.length} words, ${result.created} added, ${result.skipped} skipped (user ${userId}).`,
    );
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error("Seeding failed:", error);
  process.exit(1);
});
