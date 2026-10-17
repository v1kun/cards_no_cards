import { ok, withAuth } from "@/lib/api/respond";
import { createAIProvider } from "@/server/ai/provider-factory";
import { getDb } from "@/server/db/connection";
import { ImportRepository } from "@/server/repositories/imports";
import { serializeImportBatch } from "../../serialize";

type Context = { params: Promise<{ id: string }> };

export const POST = withAuth<Context>(async (_request, session, context) => {
  const { id } = await context.params;
  const repo = new ImportRepository(await getDb());
  const processed = await repo.process(session.userId, id, createAIProvider());
  return ok(serializeImportBatch(processed, processed.items));
});
