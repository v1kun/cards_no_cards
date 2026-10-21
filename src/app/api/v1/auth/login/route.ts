import { z } from "zod";

import { fail, handleRouteError, ok } from "@/lib/api/respond";
import { env } from "@/lib/env";
import { setSessionCookie } from "@/server/auth/local/cookie";
import { sessionSecret } from "@/server/auth/local/secret";
import { createSessionToken, SESSION_TTL_MS } from "@/server/auth/local/token";
import { getDb } from "@/server/db/connection";
import { LocalAccountsRepository } from "@/server/repositories/local-accounts";

const bodySchema = z.object({
  login: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

/** Slows down password guessing a little (proper rate limiting is tech debt). */
const FAILURE_DELAY_MS = 500;

/**
 * Temporary login for `AUTH_PROVIDER=local`: checks the login and password
 * and sets the signed session cookie. Public by design.
 */
export async function POST(request: Request) {
  try {
    const input = bodySchema.parse(await request.json().catch(() => ({})));
    const account = await new LocalAccountsRepository(await getDb()).verify(
      input.login,
      input.password,
    );
    if (!account) {
      await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
      return fail("UNAUTHORIZED", "Wrong login or password.");
    }
    const name = account.displayName ?? account.login;
    const token = createSessionToken(
      { userId: account.userId, name, expiresAt: Date.now() + SESSION_TTL_MS },
      sessionSecret(env.SESSION_SECRET),
    );
    const response = ok({ user: { userId: account.userId, name } });
    setSessionCookie(response, request, token);
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
