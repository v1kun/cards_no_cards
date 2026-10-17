import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import type { Database } from "@/server/db/client";
import { NotFoundError, ProfilesRepository, VocabularyRepository } from "@/server/repositories";
import { vocabularyItems } from "@/server/db/schema";

import { createTestDatabase, makeUserId } from "./helpers";

function session(userId: string) {
  return { userId, email: null, name: null };
}

describe("ProfilesRepository", () => {
  let db: Database;
  let close: () => void;
  let repo: ProfilesRepository;
  const userA = makeUserId("a");
  const userB = makeUserId("b");

  beforeEach(async () => {
    ({ db, close } = await createTestDatabase());
    repo = new ProfilesRepository(db);
  });

  afterEach(() => {
    close();
  });

  it("creates a profile on first ensure and is idempotent", async () => {
    const first = await repo.ensure(session(userA));
    const second = await repo.ensure(session(userA));
    expect(first.id).toBe(userA);
    expect(second.id).toBe(userA);
    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
  });

  it("returns null for a user without a profile", async () => {
    expect(await repo.get(userB)).toBeNull();
  });

  it("updates only the requested fields", async () => {
    await repo.ensure(session(userA));
    const updated = await repo.update(userA, { preferredLocale: "es", timezone: "Europe/Madrid" });
    expect(updated.preferredLocale).toBe("es");
    expect(updated.timezone).toBe("Europe/Madrid");
  });

  it("throws NotFoundError when updating a missing profile", async () => {
    await expect(repo.update(userB, { preferredLocale: "ru" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("deletes the profile and all owned data while leaving other users intact", async () => {
    const vocab = new VocabularyRepository(db);
    await repo.ensure(session(userA));
    await repo.ensure(session(userB));

    await vocab.create(userA, {
      lemma: "hablar",
      translation: "to speak",
      partOfSpeech: "verb",
      topics: ["Verbs"],
      forms: [{ form: "hablo" }],
      source: { sourceType: "manual" },
    });
    const keep = await vocab.create(userB, {
      lemma: "comer",
      translation: "to eat",
      partOfSpeech: "verb",
      topics: ["Verbs"],
      forms: [{ form: "como" }],
      source: { sourceType: "manual" },
    });

    await repo.delete(userA);

    expect(await repo.get(userA)).toBeNull();
    const remaining = await db
      .select()
      .from(vocabularyItems)
      .where(eq(vocabularyItems.userId, userA));
    expect(remaining).toHaveLength(0);

    // User B's data must survive the deletion of user A.
    expect(await repo.get(userB)).not.toBeNull();
    expect(await vocab.getById(userB, keep.id)).not.toBeNull();
  });

  it("throws NotFoundError when deleting a missing profile", async () => {
    await expect(repo.delete(userB)).rejects.toBeInstanceOf(NotFoundError);
  });
});
