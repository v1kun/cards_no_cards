import { z } from "zod";

import { ok, withAuth } from "@/lib/api/respond";
import { getDb } from "@/server/db/connection";
import { partsOfSpeech, vocabularyStatuses } from "@/server/db/schema";
import { createVocabularySchema, VocabularyRepository } from "@/server/repositories/vocabulary";
import { serializeListItem, serializeWithRelations } from "./serialize";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

const listQuerySchema = z.object({
  topicId: z.string().min(1).optional(),
  partOfSpeech: z.enum(partsOfSpeech).optional(),
  status: z.enum(vocabularyStatuses).optional(),
  dueOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GET = withAuth(async (request, session) => {
  const url = new URL(request.url);
  const query = listQuerySchema.parse(Object.fromEntries(url.searchParams));

  const repo = new VocabularyRepository(await getDb());
  const page = await repo.listPage(
    session.userId,
    {
      topicId: query.topicId,
      partOfSpeech: query.partOfSpeech,
      status: query.status,
      dueOnly: query.dueOnly,
      search: query.search,
    },
    { limit: query.limit, offset: query.offset },
  );

  return ok({
    items: page.items.map(serializeListItem),
    pagination: { total: page.total, limit: page.limit, offset: page.offset },
  });
});

export const POST = withAuth(async (request, session) => {
  const body: unknown = await request.json().catch(() => ({}));
  const input = createVocabularySchema.parse(body);

  const repo = new VocabularyRepository(await getDb());
  const created = await repo.create(session.userId, input);

  return ok({ item: serializeWithRelations(created) }, 201);
});
