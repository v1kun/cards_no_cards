import { ok, withAuth } from "@/lib/api/respond";
import { getDb } from "@/server/db/connection";
import { PracticeService } from "@/server/services/practice";

/** Everything the client needs to practice offline. */
export const GET = withAuth(async (_request, session) => {
  const service = new PracticeService(await getDb());
  return ok(await service.snapshot(session.userId));
});
