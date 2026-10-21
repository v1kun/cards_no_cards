import { z } from "zod";

/**
 * Validated, fail-fast environment configuration.
 *
 * Server-only secrets must never be imported into client components.
 * Access configuration through the exported `env` object so that a
 * missing or malformed variable fails loudly at startup instead of
 * surfacing as an obscure runtime error later.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_BASE_URL: z.string().url().default("http://localhost:3000"),
    DATABASE_URL: z.string().min(1).default("file:./local-data/cards.sqlite"),
    AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
    OPENAI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().optional(),
    // Optional custom base URL for OpenAI-compatible endpoints.
    AI_BASE_URL: z.string().url().optional(),
    // Resilience tuning for real AI adapters (ignored by the mock provider).
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).default(0),
    // Authentication provider. `local` (default) is a temporary login and
    // password flow backed by the `local_accounts` table; `dev` resolves a
    // mock session without login (tests, tooling); `cognito` (Amazon Cognito
    // + Apple) is wired up in a later phase.
    AUTH_PROVIDER: z.enum(["local", "dev", "cognito"]).default("local"),
    // Signs `local` session cookies. When unset, a random secret is kept in
    // local-data/session-secret.
    SESSION_SECRET: z.string().min(16).optional(),
    // Identity of the local development user used by the `dev` auth provider.
    DEV_USER_ID: z.string().min(1).default("dev-user"),
    DEV_USER_EMAIL: z.string().email().default("dev@example.com"),
    DEV_USER_NAME: z.string().min(1).default("Local Developer"),
  })
  .superRefine((value, ctx) => {
    if (value.AI_PROVIDER === "openai" && !value.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_API_KEY"],
        message: "OPENAI_API_KEY is required when AI_PROVIDER=openai",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

export const env: Env = parseEnv(process.env);
