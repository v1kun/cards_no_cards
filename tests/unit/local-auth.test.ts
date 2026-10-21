import { describe, expect, it } from "vitest";

import { LocalAuthProvider } from "@/server/auth/adapters/local-provider";
import { hashPassword, verifyPassword } from "@/server/auth/local/password";
import {
  createSessionToken,
  readCookie,
  readSessionToken,
  SESSION_COOKIE,
} from "@/server/auth/local/token";

const SECRET = "test-secret-0123456789";
const claims = { userId: "admin", name: "admin", expiresAt: 2_000 };

describe("local auth passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("admin");
    expect(hash).toMatch(/^scrypt\$/);
    expect(await verifyPassword("admin", hash)).toBe(true);
    expect(await verifyPassword("admin1", hash)).toBe(false);
    expect(await verifyPassword("admin", "garbage")).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});

describe("local session tokens", () => {
  it("round-trips valid claims", () => {
    expect(readSessionToken(createSessionToken(claims, SECRET), SECRET, 1_000)).toEqual(claims);
  });

  it("rejects expired, tampered and foreign tokens", () => {
    const token = createSessionToken(claims, SECRET);
    expect(readSessionToken(token, SECRET, 2_000)).toBeNull();
    expect(readSessionToken(token, "another-secret-0123456", 1_000)).toBeNull();
    const forged = Buffer.from(JSON.stringify({ ...claims, userId: "admin1" })).toString(
      "base64url",
    );
    expect(readSessionToken(`${forged}.${token.split(".")[1]}`, SECRET, 1_000)).toBeNull();
    expect(readSessionToken("nonsense", SECRET, 1_000)).toBeNull();
  });

  it("reads a cookie from the header", () => {
    const request = new Request("http://x/", {
      headers: { cookie: `a=1; ${SESSION_COOKIE}=abc.def; b=2` },
    });
    expect(readCookie(request, SESSION_COOKIE)).toBe("abc.def");
    expect(readCookie(request, "missing")).toBeNull();
  });
});

describe("LocalAuthProvider", () => {
  const provider = new LocalAuthProvider(() => SECRET);
  const withCookie = (value: string) =>
    new Request("http://x/", { headers: { cookie: `${SESSION_COOKIE}=${value}` } });

  it("returns the session of a valid cookie", async () => {
    const token = createSessionToken({ ...claims, expiresAt: Date.now() + 60_000 }, SECRET);
    expect(await provider.getSession(withCookie(token))).toEqual({
      userId: "admin",
      email: null,
      name: "admin",
    });
  });

  it("returns null without a valid cookie", async () => {
    expect(await provider.getSession(new Request("http://x/"))).toBeNull();
    expect(await provider.getSession(withCookie("bad.token"))).toBeNull();
  });
});
