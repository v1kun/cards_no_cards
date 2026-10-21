import { z } from "zod";

import { ok, withAuth } from "@/lib/api/respond";
import { createAIProvider } from "@/server/ai/provider-factory";
import { getDb } from "@/server/db/connection";
import { ExerciseBankService } from "@/server/services/exercise-bank";

const refreshSchema = z.object({
  exclude: z.array(z.string().min(1).max(64)).max(5000).optional(),
});

/** Generates questions for the next batch of new or changed words. */
export const POST = withAuth(async (request, session) => {
  const body: unknown = await request.json().catch(() => ({}));
  const input = refreshSchema.parse(body);
  const service = new ExerciseBankService(await getDb(), createAIProvider());
  return ok(await service.refresh(session.userId, input));
});
