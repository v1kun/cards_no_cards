import { z } from "zod";

import { ApiError, ok, withAuth } from "@/lib/api/respond";
import { getDb } from "@/server/db/connection";
import { ImportRepository, updateImportItemSchema } from "@/server/repositories/imports";
import { serializeImportBatch } from "../serialize";

type Context = { params: Promise<{ id: string }> };

const patchBodySchema = z.object({
  items: z.array(updateImportItemSchema).min(1),
});

export const GET = withAuth<Context>(async (_request, session, context) => {
  const { id } = await context.params;
  const repo = new ImportRepository(await getDb());
  const batch = await repo.getById(session.userId, id);
  if (!batch) {
    throw new ApiError("NOT_FOUND", "Import batch not found.");
  }
  return ok(serializeImportBatch(batch, batch.items));
});

export const PATCH = withAuth<Context>(async (request, session, context) => {
  const { id } = await context.params;
  const body: unknown = await request.json().catch(() => ({}));
  const { items } = patchBodySchema.parse(body);

  const repo = new ImportRepository(await getDb());
  const updated = await repo.updateItems(session.userId, id, items);
  return ok(serializeImportBatch(updated, updated.items));
});
