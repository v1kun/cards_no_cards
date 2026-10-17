import type { AuthProvider, AuthSession } from "../types";

/**
 * Local development authentication.
 *
 * Resolves a stable mock session without any real login flow, so the rest
 * of the application can be built and tested against the same `AuthProvider`
 * contract that Amazon Cognito will implement later.
 *
 * The configured developer identity is used by default. To exercise
 * per-user data isolation locally (e.g. "user A cannot see user B's data"),
 * a request may override the identity with the `x-dev-user-id` header.
 */
export class DevAuthProvider implements AuthProvider {
  readonly name = "dev";

  constructor(
    private readonly defaults: {
      userId: string;
      email: string | null;
      name: string | null;
    },
  ) {}

  getSession(request: Request): Promise<AuthSession | null> {
    const override = request.headers.get("x-dev-user-id")?.trim();

    if (override) {
      // An explicit override identifies a different local user; only the id
      // is known for overridden users.
      return Promise.resolve({ userId: override, email: null, name: null });
    }

    return Promise.resolve({
      userId: this.defaults.userId,
      email: this.defaults.email,
      name: this.defaults.name,
    });
  }
}
