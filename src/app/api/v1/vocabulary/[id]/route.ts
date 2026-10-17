import { z } from "zod";

import { ok, withAuth } from "@/lib/api/respond";
import { getDb } from "@/server/db/connection";
import { NotFoundError } from "@/server/repositories/errors";
import { updateVocabularySchema, VocabularyRepository } from "@/server/repositories/vocabulary";
import { serializeDetail } from "../serialize";

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = updateVocabularySchema.extend({
  topics: z.array(z.string().min(1)).optional(),
});

async function loadDetail(repo: VocabularyRepository, userId: string, id: string) {
  const detail = await repo.getDetail(userId, id);
  if (!detail) {
    throw new NotFoundError("VocabularyItem", id);
  }
  return detail;
}

export const GET = withAuth(async (_request, session, context: RouteContext) => {
  const { id } = await context.params;
  const repo = new VocabularyRepository(await getDb());
  return ok({ item: serializeDetail(await loadDetail(repo, session.userId, id)) });
});

export const PATCH = withAuth(async (request, session, context: RouteContext) => {
  const { id } = await context.params;
  const body: unknown = await request.json().catch(() => ({}));
  const { topics, ...fields } = patchSchema.parse(body);

  const repo = new VocabularyRepository(await getDb());
  // Establishes ownership before applying any change.
  await loadDetail(repo, session.userId, id);

  if (Object.keys(fields).length > 0) {
    await repo.update(session.userId, id, fields);
  }
  if (topics !== undefined) {
    await repo.setTopics(session.userId, id, topics);
  }

  return ok({ item: serializeDetail(await loadDetail(repo, session.userId, id)) });
});

const deleteQuerySchema = z.object({
  hard: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const DELETE = withAuth(async (request, session, context: RouteContext) => {
  const { id } = await context.params;
  const { hard } = deleteQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));

  const repo = new VocabularyRepository(await getDb());

  if (hard) {
    // Permanent deletion removes dependent forms, links, sources, and
    // review history via foreign-key cascades.
    await repo.delete(session.userId, id);
    return ok({ deleted: true, id });
  }

  const archived = await repo.archive(session.userId, id);
  return ok({ item: serializeDetail(await loadDetail(repo, session.userId, archived.id)) });
});
