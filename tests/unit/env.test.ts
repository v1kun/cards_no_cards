import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("applies defaults for an empty environment", () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.AI_PROVIDER).toBe("mock");
    expect(env.APP_BASE_URL).toBe("http://localhost:3000");
  });

  it("rejects an invalid APP_BASE_URL", () => {
    expect(() => parseEnv({ APP_BASE_URL: "not-a-url" })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it("requires OPENAI_API_KEY when AI_PROVIDER=openai", () => {
    expect(() => parseEnv({ AI_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY is required/);
  });

  it("accepts AI_PROVIDER=openai when a key is provided", () => {
    const env = parseEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
    expect(env.AI_PROVIDER).toBe("openai");
  });
});
