import { ok, withAuth } from "@/lib/api/respond";
import { getDb } from "@/server/db/connection";
import { PracticeService, syncInputSchema } from "@/server/services/practice";

/** Applies answers recorded offline. Idempotent per attempt id. */
export const POST = withAuth(async (request, session) => {
  const body: unknown = await request.json().catch(() => ({}));
  const input = syncInputSchema.parse(body);
  const service = new PracticeService(await getDb());
  return ok(await service.sync(session.userId, input));
});
