import { ok, withAuth } from "@/lib/api/respond";
import { getDb } from "@/server/db/connection";
import { ExerciseBankService } from "@/server/services/exercise-bank";

export const GET = withAuth(async (_request, session) => {
  const service = new ExerciseBankService(await getDb());
  return ok(await service.status(session.userId));
});
