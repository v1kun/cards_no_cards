import { NextResponse } from "next/server";

/**
 * Public, unauthenticated health check.
 *
 * Returns a minimal payload so local tooling, Docker health checks, and
 * future deployment smoke tests can confirm the app is serving requests.
 * It must not expose secrets or environment details.
 */
export function GET() {
  return NextResponse.json({
    data: { status: "ok" },
    error: null,
    requestId: crypto.randomUUID(),
  });
}
