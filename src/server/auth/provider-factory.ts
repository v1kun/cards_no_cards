import "server-only";

import { env } from "@/lib/env";
import type { AuthProvider } from "./types";
import { DevAuthProvider } from "./adapters/dev-provider";
import { LocalAuthProvider } from "./adapters/local-provider";
import { sessionSecret } from "./local/secret";

/**
 * Returns the configured authentication provider adapter.
 *
 * Selection is configuration-driven via `AUTH_PROVIDER`. The real Cognito
 * adapter is added here behind the same interface; application code never
 * imports an auth SDK directly.
 */
export function createAuthProvider(): AuthProvider {
  switch (env.AUTH_PROVIDER) {
    case "dev":
      return new DevAuthProvider({
        userId: env.DEV_USER_ID,
        email: env.DEV_USER_EMAIL,
        name: env.DEV_USER_NAME,
      });
    case "local":
      return new LocalAuthProvider(() => sessionSecret(env.SESSION_SECRET));
    case "cognito":
      // The Cognito adapter is introduced in the deployment/auth phase.
      throw new Error(
        "AUTH_PROVIDER=cognito is not implemented yet. Set AUTH_PROVIDER=dev for local development.",
      );
    default: {
      const exhaustive: never = env.AUTH_PROVIDER;
      throw new Error(`Unsupported AUTH_PROVIDER: ${String(exhaustive)}`);
    }
  }
}
