import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "cnc_session";

/**
 * Sends signed-out visitors to /login (temporary `local` auth). Only checks
 * that the cookie exists — the signature is verified by the API on every
 * request, which answers 401 and makes the client return here.
 */
export function middleware(request: NextRequest) {
  if ((process.env.AUTH_PROVIDER ?? "local") !== "local") return NextResponse.next();
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Pages only: API routes enforce auth themselves; static files stay public.
  matcher: [
    "/((?!api/|login|_next/|icons/|sw\\.js|manifest\\.webmanifest|robots\\.txt|favicon).*)",
  ],
};
