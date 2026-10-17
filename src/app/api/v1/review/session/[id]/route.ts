import { ok, withAuth } from "@/lib/api/respond";
import { getDb } from "@/server/db/connection";
import { PracticeService } from "@/server/services/practice";
import { serializeSession } from "../../serialize";

type Context = { params: Promise<{ id: string }> };

export const GET = withAuth<Context>(async (_request, session, context) => {
  const { id } = await context.params;
  const service = new PracticeService(await getDb());
  const { session: practiceSession, summary } = await service.getSession(session.userId, id);

  return ok({ session: serializeSession(practiceSession), summary });
});

export const PATCH = withAuth<Context>(async (_request, session, context) => {
  const { id } = await context.params;
  const service = new PracticeService(await getDb());
  const summary = await service.completeSession(session.userId, id);
  const { session: practiceSession } = await service.getSession(session.userId, id);

  return ok({ session: serializeSession(practiceSession), summary });
});
