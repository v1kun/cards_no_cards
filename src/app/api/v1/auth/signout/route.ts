import { ok } from "@/lib/api/respond";
import { clearSessionCookie } from "@/server/auth/local/cookie";

/**
 * Sign-out endpoint: clears the local session cookie. Public, so an expired
 * or invalid session can always be cleared. The Cognito adapter will add
 * token revocation behind the same contract.
 */
export function POST(request: Request) {
  const response = ok({ signedOut: true });
  clearSessionCookie(response, request);
  return response;
}
