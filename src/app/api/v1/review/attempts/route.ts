import { ok, withAuth } from "@/lib/api/respond";
import { createAIProvider } from "@/server/ai/provider-factory";
import { getDb } from "@/server/db/connection";
import { PracticeService, submitAttemptSchema } from "@/server/services/practice";

export const POST = withAuth(async (request, session) => {
  const body: unknown = await request.json().catch(() => ({}));
  const input = submitAttemptSchema.parse(body);

  const service = new PracticeService(await getDb(), createAIProvider());
  const outcome = await service.submitAttempt(session.userId, input);

  return ok(outcome);
});
