import { ok, withAuth } from "@/lib/api/respond";
import { createAIProvider } from "@/server/ai/provider-factory";
import { getDb } from "@/server/db/connection";
import { PracticeService } from "@/server/services/practice";
import { serializeSession } from "../serialize";

export const POST = withAuth(async (_request, session) => {
  const service = new PracticeService(await getDb(), createAIProvider());
  const plan = await service.startSession(session.userId);

  return ok(
    {
      session: plan.session ? serializeSession(plan.session) : null,
      exercises: plan.exercises,
    },
    201,
  );
});
