import { ok, withAuth } from "@/lib/api/respond";
import { getDb } from "@/server/db/connection";
import { ImportRepository } from "@/server/repositories/imports";

type Context = { params: Promise<{ id: string }> };

export const POST = withAuth<Context>(async (_request, session, context) => {
  const { id } = await context.params;
  const repo = new ImportRepository(await getDb());
  const result = await repo.confirm(session.userId, id);

  return ok({
    batchId: result.batch.id,
    status: result.batch.status,
    createdVocabularyItemIds: result.createdVocabularyItemIds,
    mergedVocabularyItemIds: result.mergedVocabularyItemIds,
  });
});
