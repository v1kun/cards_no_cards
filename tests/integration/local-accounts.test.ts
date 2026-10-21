import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@/server/db/client";
import { LocalAccountsRepository } from "@/server/repositories/local-accounts";

import { createTestDatabase } from "./helpers";

describe("LocalAccountsRepository", () => {
  let db: Database;
  let close: () => void;

  beforeEach(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterEach(() => close());

  it("creates, verifies and resets accounts", async () => {
    const accounts = new LocalAccountsRepository(db);
    expect(await accounts.upsert({ login: "Admin", password: "admin", userId: "admin" })).toBe(
      true,
    );
    expect(await accounts.verify(" ADMIN ", "admin")).toMatchObject({
      userId: "admin",
      login: "admin",
    });
    expect(await accounts.verify("admin", "wrong")).toBeNull();
    expect(await accounts.verify("nobody", "admin")).toBeNull();

    expect(await accounts.upsert({ login: "admin", password: "new", userId: "admin" })).toBe(false);
    expect(await accounts.verify("admin", "admin")).toBeNull();
    expect(await accounts.verify("admin", "new")).not.toBeNull();
  });
});
