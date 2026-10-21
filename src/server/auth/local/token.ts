import { createHmac, timingSafeEqual } from "node:crypto";

/** Session cookie name for the local auth provider. */
export const SESSION_COOKIE = "cnc_session";
/** Sessions last 30 days so the PWA keeps working offline between visits. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionClaims = { userId: string; name: string | null; expiresAt: number };

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Encodes claims as `<payload>.<hmac>` (base64url). */
export function createSessionToken(claims: SessionClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the claims of a valid, unexpired token, or null. */
export function readSessionToken(
  token: string,
  secret: string,
  now = Date.now(),
): SessionClaims | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionClaims;
    if (typeof claims.userId !== "string" || typeof claims.expiresAt !== "number") return null;
    return claims.expiresAt > now ? claims : null;
  } catch {
    return null;
  }
}

/** Reads one cookie value from a request's Cookie header. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
