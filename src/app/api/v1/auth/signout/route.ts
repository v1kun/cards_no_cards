import { ok, withAuth } from "@/lib/api/respond";

/**
 * Sign-out endpoint.
 *
 * With the `dev` provider there is no real session to revoke, so this simply
 * acknowledges the request. The Cognito adapter replaces this behavior with
 * token/session invalidation and cookie clearing, without changing the
 * contract callers depend on. Protected so only an authenticated caller can
 * sign out.
 */
export const POST = withAuth(() => {
  return ok({ signedOut: true });
});
