import { readCookie, readSessionToken, SESSION_COOKIE } from "../local/token";
import type { AuthProvider, AuthSession } from "../types";

/**
 * Temporary login/password authentication (tech debt — replaced by Cognito).
 * Accounts live in `local_accounts`; the session is an HMAC-signed cookie
 * issued by `POST /api/v1/auth/login`.
 */
export class LocalAuthProvider implements AuthProvider {
  readonly name = "local";

  constructor(private readonly secret: () => string) {}

  getSession(request: Request): Promise<AuthSession | null> {
    const token = readCookie(request, SESSION_COOKIE);
    const claims = token ? readSessionToken(token, this.secret()) : null;
    return Promise.resolve(
      claims ? { userId: claims.userId, email: null, name: claims.name ?? null } : null,
    );
  }
}
