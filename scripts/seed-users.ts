import { resolve } from "node:path";

import { env } from "@/lib/env";
import { createDatabase } from "@/server/db/client";
import { LocalAccountsRepository } from "@/server/repositories/local-accounts";
import { ProfilesRepository } from "@/server/repositories/profiles";
import { loadStarterDeck, seedStarterDeck } from "@/server/starter-deck/seed";

/**
 * Temporary local accounts (see DEFERRED_FEATURES.md → tech debt): password = login.
 * `npm run users:seed` — safe to re-run; passwords are reset, existing words are kept.
 */
const USERS = [
  { login: "admin", password: "admin", userId: "admin", displayName: "admin" },
  { login: "admin1", password: "admin1", userId: "admin1", displayName: "admin1" },
];
const DECK = "es-a1";

async function main() {
  const { entries, issues } = await loadStarterDeck(
    resolve(process.cwd(), "data/starter-decks", DECK),
  );
  if (issues.length > 0) throw new Error(`${issues.length} invalid row(s) in deck ${DECK}.`);

  const { db, client } = await createDatabase(env.DATABASE_URL);
  try {
    const accounts = new LocalAccountsRepository(db);
    const profiles = new ProfilesRepository(db);
    for (const user of USERS) {
      const created = await accounts.upsert(user);
      await profiles.ensure({ userId: user.userId, email: null, name: user.displayName });
      // The starter deck is translated into Russian.
      if (created) await profiles.update(user.userId, { translationLanguage: "ru" });
      const deck = await seedStarterDeck(db, user.userId, entries, `starter-deck:${DECK}`);
      console.log(
        `${user.login}: account ${created ? "created" : "updated"}, deck ${DECK} +${deck.created} (${deck.skipped} kept).`,
      );
    }
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error("Seeding users failed:", error);
  process.exit(1);
});
