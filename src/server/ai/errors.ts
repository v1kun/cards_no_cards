/**
 * Typed errors for the AI provider layer.
 *
 * Domain services catch these vendor-neutral errors rather than
 * provider-specific SDK errors, so switching providers never leaks a new
 * error type into domain logic.
 */

/** Base class for every failure originating in the AI provider layer. */
export class AIProviderError extends Error {
  readonly provider: string;
  override readonly cause?: unknown;

  constructor(message: string, options: { provider: string; cause?: unknown }) {
    super(message);
    this.name = "AIProviderError";
    this.provider = options.provider;
    this.cause = options.cause;
  }
}

/** The provider did not respond within the configured timeout. */
export class AITimeoutError extends AIProviderError {
  readonly timeoutMs: number;

  constructor(options: { provider: string; timeoutMs: number; cause?: unknown }) {
    super(`AI request timed out after ${options.timeoutMs}ms`, options);
    this.name = "AITimeoutError";
    this.timeoutMs = options.timeoutMs;
  }
}

/** The provider was reachable but returned output that failed validation. */
export class AIResponseError extends AIProviderError {
  constructor(message: string, options: { provider: string; cause?: unknown }) {
    super(message, options);
    this.name = "AIResponseError";
  }
}

/** The provider rejected the request because of rate limiting. */
export class AIRateLimitError extends AIProviderError {
  constructor(options: { provider: string; cause?: unknown }) {
    super("AI request was rate limited", options);
    this.name = "AIRateLimitError";
  }
}
