import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AIProviderError } from "@/server/ai/errors";
import { UnauthorizedError } from "@/server/auth/errors";
import type { AuthSession } from "@/server/auth/types";
import { requireSession } from "@/server/auth/session";
import {
  NotFoundError,
  OwnershipError,
  ValidationError,
  ConflictError,
} from "@/server/repositories/errors";

/**
 * Consistent JSON API envelope and error handling for route handlers.
 *
 * Every response follows `{ data, error, requestId }`. Errors are mapped to
 * stable, client-safe codes; internal details (stack traces, SQL, provider
 * messages, secrets) are never exposed.
 */

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "AI_UNAVAILABLE"
  | "INTERNAL";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  AI_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** An error a route handler can throw to produce a specific API response. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function requestId(): string {
  return crypto.randomUUID();
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data, error: null, requestId: requestId() }, { status });
}

export function fail(code: ApiErrorCode, message: string): NextResponse {
  return NextResponse.json(
    { data: null, error: { code, message }, requestId: requestId() },
    { status: STATUS_BY_CODE[code] },
  );
}

/**
 * Maps a thrown value to a safe API error response. Known domain errors get
 * specific codes; anything else becomes a generic 500 with no leaked detail.
 *
 * Ownership failures are reported as NOT_FOUND so the API never reveals the
 * existence of another user's records.
 */
export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return fail(error.code, error.message);
  }
  if (error instanceof UnauthorizedError) {
    return fail("UNAUTHORIZED", error.message);
  }
  if (error instanceof ValidationError) {
    return fail("VALIDATION_ERROR", error.message);
  }
  if (error instanceof ZodError) {
    return fail("VALIDATION_ERROR", "The request could not be validated.");
  }
  if (error instanceof NotFoundError || error instanceof OwnershipError) {
    return fail("NOT_FOUND", "The requested resource was not found.");
  }
  if (error instanceof ConflictError) {
    return fail("CONFLICT", error.message);
  }
  if (error instanceof AIProviderError) {
    console.error("AI provider error:", error.message);
    return fail("AI_UNAVAILABLE", "The AI service is unavailable. Please try again later.");
  }

  console.error("Unhandled route error:", error);
  return fail("INTERNAL", "An unexpected error occurred.");
}

type RouteHandler<Ctx> = (
  request: Request,
  session: AuthSession,
  context: Ctx,
) => Promise<NextResponse> | NextResponse;

/**
 * Wraps a route handler so it only runs for authenticated requests.
 *
 * Unauthenticated requests are rejected with a 401 before the handler runs;
 * authenticated requests receive the resolved {@link AuthSession}. Thrown
 * domain errors are converted to the standard envelope.
 */
export function withAuth<Ctx = unknown>(handler: RouteHandler<Ctx>) {
  return async (request: Request, context: Ctx): Promise<NextResponse> => {
    try {
      const session = await requireSession(request);
      return await handler(request, session, context);
    } catch (error) {
      return handleRouteError(error);
    }
  };
}
