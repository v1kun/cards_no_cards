import { ok, withAuth } from "@/lib/api/respond";
import { createAIProvider } from "@/server/ai/provider-factory";
import { getDb } from "@/server/db/connection";
import { ExerciseBankService } from "@/server/services/exercise-bank";

type Context = { params: Promise<{ id: string }> };

export const POST = withAuth<Context>(async (_request, session, context) => {
  const { id } = await context.params;
  const service = new ExerciseBankService(await getDb(), createAIProvider());
  return ok(await service.regenerate(session.userId, id));
});
