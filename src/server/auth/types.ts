/**
 * Vendor-neutral authentication contract.
 *
 * Application code depends on these types only. Provider-specific session
 * verification, token handling, and SDK imports live inside the individual
 * adapters under `./adapters`. Swapping the `dev` provider for Amazon
 * Cognito must not require changes outside this module.
 */

/**
 * An authenticated principal.
 *
 * `userId` is the stable external identity (the Cognito `sub` in production,
 * a configured id in development). It is the value stored as `user_id` on
 * every owned row — the application never mints its own user identifiers.
 */
export type AuthSession = {
  readonly userId: string;
  readonly email: string | null;
  readonly name: string | null;
};

export interface AuthProvider {
  readonly name: string;

  /**
   * Resolves the session for an incoming request, or `null` when the
   * request is unauthenticated. Must never throw for an ordinary missing
   * or invalid session; callers decide how to handle `null`.
   */
  getSession(request: Request): Promise<AuthSession | null>;
}
