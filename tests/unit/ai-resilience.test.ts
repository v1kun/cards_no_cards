import { describe, expect, it, vi } from "vitest";

import { AITimeoutError } from "@/server/ai/errors";
import { RateLimiter, withRetry, withTimeout } from "@/server/ai/resilience";

describe("withTimeout", () => {
  it("resolves when the promise settles in time", async () => {
    await expect(
      withTimeout(Promise.resolve(42), { timeoutMs: 50, provider: "test" }),
    ).resolves.toBe(42);
  });

  it("rejects with AITimeoutError when the promise is too slow", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 50));
    await expect(withTimeout(slow, { timeoutMs: 5, provider: "test" })).rejects.toBeInstanceOf(
      AITimeoutError,
    );
  });

  it("treats a non-positive timeout as disabled", async () => {
    await expect(
      withTimeout(Promise.resolve("ok"), { timeoutMs: 0, provider: "test" }),
    ).resolves.toBe("ok");
  });
});

describe("withRetry", () => {
  const noSleep = async () => {};

  it("returns immediately on success without retrying", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn, { maxRetries: 3, sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxRetries then succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("transient");
      }
      return "recovered";
    });
    await expect(withRetry(fn, { maxRetries: 3, sleep: noSleep, random: () => 0 })).resolves.toBe(
      "recovered",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after exhausting the retry budget", async () => {
    const fn = vi.fn(async () => {
      throw new Error("always");
    });
    await expect(withRetry(fn, { maxRetries: 2, sleep: noSleep })).rejects.toThrow("always");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when shouldRetry returns false", async () => {
    const fn = vi.fn(async () => {
      throw new Error("fatal");
    });
    await expect(
      withRetry(fn, { maxRetries: 5, sleep: noSleep, shouldRetry: () => false }),
    ).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("RateLimiter", () => {
  it("spaces consecutive calls by at least the minimum interval", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = new RateLimiter({
      minIntervalMs: 100,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    await limiter.schedule(async () => "a");
    await limiter.schedule(async () => "b");
    await limiter.schedule(async () => "c");

    // First call runs immediately; each subsequent call waits the interval.
    expect(sleeps).toEqual([100, 100]);
  });

  it("keeps scheduling after a scheduled call rejects", async () => {
    const limiter = new RateLimiter({ minIntervalMs: 0 });
    await expect(
      limiter.schedule(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(limiter.schedule(async () => "next")).resolves.toBe("next");
  });
});
