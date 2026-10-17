import { z } from "zod";

import { ok, withAuth } from "@/lib/api/respond";
import { getDb } from "@/server/db/connection";
import { TopicsRepository, type Topic } from "@/server/repositories/topics";

function serializeTopic(topic: Topic) {
  return {
    id: topic.id,
    name: topic.name,
    normalizedName: topic.normalizedName,
    createdAt: topic.createdAt.toISOString(),
  };
}

export const GET = withAuth(async (_request, session) => {
  const repo = new TopicsRepository(await getDb());
  const topics = await repo.list(session.userId);
  return ok({ topics: topics.map(serializeTopic) });
});

const createSchema = z.object({ name: z.string().trim().min(1).max(100) });

export const POST = withAuth(async (request, session) => {
  const body: unknown = await request.json().catch(() => ({}));
  const { name } = createSchema.parse(body);

  const repo = new TopicsRepository(await getDb());
  // Normalizes whitespace/case and returns the existing topic on duplicate.
  const topic = await repo.findOrCreate(session.userId, name);
  return ok({ topic: serializeTopic(topic) }, 201);
});
