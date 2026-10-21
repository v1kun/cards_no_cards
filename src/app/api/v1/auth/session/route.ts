import { ok } from "@/lib/api/respond";
import { getSession } from "@/server/auth/session";

/** The signed-in user, or `null` — lets the client tell who is logged in. */
export async function GET(request: Request) {
  const session = await getSession(request);
  return ok({
    user: session ? { userId: session.userId, name: session.name ?? session.userId } : null,
  });
}
