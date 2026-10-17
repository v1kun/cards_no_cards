import "server-only";

import { createAuthProvider } from "./provider-factory";
import { UnauthorizedError } from "./errors";
import type { AuthSession } from "./types";

/**
 * Resolves the current session for a request, or `null` when the request is
 * unauthenticated. Use this for routes that behave differently for signed-in
 * and anonymous callers.
 */
export function getSession(request: Request): Promise<AuthSession | null> {
  return createAuthProvider().getSession(request);
}

/**
 * Resolves the current session or throws {@link UnauthorizedError}.
 *
 * This is the single enforcement point for protected routes: it guarantees
 * a non-null session so handlers can scope every query by `session.userId`.
 */
export async function requireSession(request: Request): Promise<AuthSession> {
  const session = await getSession(request);
  if (!session) {
    throw new UnauthorizedError();
  }
  return session;
}
