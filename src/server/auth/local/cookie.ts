import type { NextResponse } from "next/server";

import { SESSION_COOKIE, SESSION_TTL_MS } from "./token";

/** `Secure` only over HTTPS; plain-HTTP LAN access would otherwise drop the cookie. */
function isHttps(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  return (forwarded ?? new URL(request.url).protocol.replace(":", "")) === "https";
}

export function setSessionCookie(response: NextResponse, request: Request, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(request),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(response: NextResponse, request: Request) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(request),
    path: "/",
    maxAge: 0,
  });
}
