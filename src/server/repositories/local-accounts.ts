import { eq } from "drizzle-orm";

import { hashPassword, verifyPassword } from "@/server/auth/local/password";
import type { Database } from "@/server/db/client";
import { localAccounts } from "@/server/db/schema";

export type LocalAccount = { userId: string; login: string; displayName: string | null };

/** Temporary local login accounts (see `AUTH_PROVIDER=local`). */
export class LocalAccountsRepository {
  constructor(private readonly db: Database) {}

  /** Creates the account or resets its password; returns true when created. */
  async upsert(input: {
    login: string;
    password: string;
    userId: string;
    displayName?: string | null;
  }): Promise<boolean> {
    const passwordHash = await hashPassword(input.password);
    const login = input.login.trim().toLowerCase();
    const existing = await this.db
      .select({ id: localAccounts.id })
      .from(localAccounts)
      .where(eq(localAccounts.login, login))
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(localAccounts)
        .set({ passwordHash, userId: input.userId, displayName: input.displayName ?? null })
        .where(eq(localAccounts.id, existing[0].id));
      return false;
    }
    await this.db.insert(localAccounts).values({
      login,
      userId: input.userId,
      displayName: input.displayName ?? null,
      passwordHash,
    });
    return true;
  }

  /** Returns the account when the login and password match. */
  async verify(login: string, password: string): Promise<LocalAccount | null> {
    const rows = await this.db
      .select()
      .from(localAccounts)
      .where(eq(localAccounts.login, login.trim().toLowerCase()))
      .limit(1);
    const account = rows[0];
    if (!account || !(await verifyPassword(password, account.passwordHash))) return null;
    return { userId: account.userId, login: account.login, displayName: account.displayName };
  }
}
