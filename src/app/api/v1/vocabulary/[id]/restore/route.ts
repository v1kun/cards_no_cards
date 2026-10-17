import { ok, withAuth } from "@/lib/api/respond";
import { getDb } from "@/server/db/connection";
import { NotFoundError } from "@/server/repositories/errors";
import { VocabularyRepository } from "@/server/repositories/vocabulary";
import { serializeDetail } from "../../serialize";

type RouteContext = { params: Promise<{ id: string }> };

/** Restores an archived word back to active status. */
export const POST = withAuth(async (_request, session, context: RouteContext) => {
  const { id } = await context.params;
  const repo = new VocabularyRepository(await getDb());
  await repo.restore(session.userId, id);

  const detail = await repo.getDetail(session.userId, id);
  if (!detail) {
    throw new NotFoundError("VocabularyItem", id);
  }
  return ok({ item: serializeDetail(detail) });
});
