import { ok, withAuth } from "@/lib/api/respond";
import { createAIProvider } from "@/server/ai/provider-factory";
import { getDb } from "@/server/db/connection";
import { createImportSchema, ImportRepository } from "@/server/repositories/imports";
import { serializeImportBatch } from "./serialize";

export const POST = withAuth(async (request, session) => {
  const body: unknown = await request.json().catch(() => ({}));
  const input = createImportSchema.parse(body);

  const repo = new ImportRepository(await getDb());
  const batch = await repo.create(session.userId, input);
  const processed = await repo.process(session.userId, batch.id, createAIProvider());

  return ok(serializeImportBatch(processed, processed.items), 201);
});
