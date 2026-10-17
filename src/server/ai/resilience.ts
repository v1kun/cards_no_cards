import { AITimeoutError } from "./errors";

/**
 * Vendor-neutral resilience helpers shared by AI adapters: per-request
 * timeouts, bounded retries with exponential backoff and jitter, and a
 * minimum-interval rate limiter. Adapters compose these so that timeout,
 * retry, and rate-limit behaviour is consistent and testable independent
 * of any specific provider SDK.
 */

/** Rejects with {@link AITimeoutError} if `promise` does not settle in time. */
export async function withTimeout<T>(
  promise: Promise<T>,
  options: { timeoutMs: number; provider: string },
): Promise<T> {
  if (options.timeoutMs <= 0) {
    return promise;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AITimeoutError({ provider: options.provider, timeoutMs: options.timeoutMs }));
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export type RetryOptions = {
  maxRetries: number;
  /** Base delay in milliseconds for the first retry. */
  baseDelayMs?: number;
  /** Upper bound for a single backoff delay. */
  maxDelayMs?: number;
  /** Decides whether a given error is worth retrying. */
  shouldRetry?: (error: unknown) => boolean;
  /** Injectable sleep, overridable in tests to avoid real delays. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter in [0, 1); overridable in tests for determinism. */
  random?: () => number;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, retrying on failure up to `maxRetries` times using
 * exponential backoff with full jitter. Re-throws the last error when the
 * retry budget is exhausted or `shouldRetry` returns false.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    maxRetries,
    baseDelayMs = 250,
    maxDelayMs = 5_000,
    shouldRetry = () => true,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  let attempt = 0;
  // Total tries = 1 initial attempt + up to `maxRetries` retries.
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(error)) {
        throw error;
      }
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const delay = Math.round(exponential * random());
      await sleep(delay);
      attempt += 1;
    }
  }
}

/**
 * Serializes calls and enforces a minimum interval between them, smoothing
 * bursts into a steady request rate. Instances are process-local; one per
 * provider adapter is sufficient for a single-user app.
 */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private lastRunAt = Number.NEGATIVE_INFINITY;

  constructor(options: {
    minIntervalMs: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.minIntervalMs = Math.max(0, options.minIntervalMs);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Schedules `fn` so that consecutive runs are spaced by `minIntervalMs`. */
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      if (this.minIntervalMs > 0) {
        const wait = this.lastRunAt + this.minIntervalMs - this.now();
        if (wait > 0) {
          await this.sleep(wait);
        }
      }
      this.lastRunAt = this.now();
    });

    // Keep the gate chained even if the current run rejects.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );

    await run;
    return fn();
  }
}
