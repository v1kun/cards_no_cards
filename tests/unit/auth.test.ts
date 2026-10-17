import { describe, expect, it } from "vitest";

import { DevAuthProvider } from "@/server/auth/adapters/dev-provider";
import { ApiError, handleRouteError, ok, withAuth } from "@/lib/api/respond";
import { UnauthorizedError } from "@/server/auth/errors";
import { NotFoundError, OwnershipError, ValidationError } from "@/server/repositories/errors";

const devDefaults = { userId: "dev-user", email: "dev@example.com", name: "Local Developer" };

function request(headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/v1/me", { headers });
}

describe("DevAuthProvider", () => {
  it("resolves the configured developer session by default", async () => {
    const provider = new DevAuthProvider(devDefaults);
    const session = await provider.getSession(request());
    expect(session).toEqual({
      userId: "dev-user",
      email: "dev@example.com",
      name: "Local Developer",
    });
  });

  it("honors the x-dev-user-id override for testing user isolation", async () => {
    const provider = new DevAuthProvider(devDefaults);
    const session = await provider.getSession(request({ "x-dev-user-id": "user-b" }));
    expect(session?.userId).toBe("user-b");
    expect(session?.email).toBeNull();
  });

  it("ignores a blank override header", async () => {
    const provider = new DevAuthProvider(devDefaults);
    const session = await provider.getSession(request({ "x-dev-user-id": "   " }));
    expect(session?.userId).toBe("dev-user");
  });
});

describe("handleRouteError", () => {
  it("maps UnauthorizedError to a 401 envelope", async () => {
    const res = handleRouteError(new UnauthorizedError());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ data: null, error: { code: "UNAUTHORIZED" } });
    expect(body.requestId).toEqual(expect.any(String));
  });

  it("maps validation errors to 400", async () => {
    const res = handleRouteError(new ValidationError("bad"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("maps not-found and ownership errors to 404 without leaking details", async () => {
    const notFound = handleRouteError(new NotFoundError("Profile", "x"));
    const ownership = handleRouteError(new OwnershipError("Topic", "y"));
    expect(notFound.status).toBe(404);
    expect(ownership.status).toBe(404);
    const body = await ownership.json();
    expect(body.error.message).not.toContain("y");
  });

  it("maps unknown errors to a generic 500", async () => {
    const res = handleRouteError(new Error("db exploded: SELECT secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).not.toContain("secret");
  });

  it("passes ApiError through with its code", async () => {
    const res = handleRouteError(new ApiError("FORBIDDEN", "nope"));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });
});

describe("withAuth", () => {
  it("runs the handler with the resolved session for authenticated requests", async () => {
    const handler = withAuth((_req, session) => {
      return ok({ userId: session.userId });
    });
    const res = await handler(request(), undefined);
    expect(res.status).toBe(200);
    expect((await res.json()).data.userId).toBe("dev-user");
  });

  it("converts thrown domain errors into the standard envelope", async () => {
    const handler = withAuth(() => {
      throw new NotFoundError("Profile", "dev-user");
    });
    const res = await handler(request(), undefined);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });
});
