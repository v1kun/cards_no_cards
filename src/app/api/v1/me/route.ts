import { z } from "zod";

import { ok, withAuth } from "@/lib/api/respond";
import { getDb } from "@/server/db/connection";
import { ProfilesRepository } from "@/server/repositories/profiles";
import type { AuthSession } from "@/server/auth/types";

/**
 * Current-user profile and account endpoints.
 *
 * Protected by {@link withAuth}: unauthenticated requests are rejected with
 * 401 before any handler runs, and every operation is scoped to the
 * authenticated user's own identity — a caller can never address another
 * user's profile.
 */

function serialize(profile: {
  id: string;
  preferredLocale: string;
  timezone: string | null;
  onboardingCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: profile.id,
    preferredLocale: profile.preferredLocale,
    timezone: profile.timezone,
    onboardingCompletedAt: profile.onboardingCompletedAt?.toISOString() ?? null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export const GET = withAuth(async (_request: Request, session: AuthSession) => {
  const repo = new ProfilesRepository(await getDb());
  const profile = await repo.ensure(session);
  return ok({ profile: serialize(profile) });
});

const patchSchema = z.object({
  preferredLocale: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).max(64).nullish(),
  onboardingCompleted: z.boolean().optional(),
});

export const PATCH = withAuth(async (request: Request, session: AuthSession) => {
  const body: unknown = await request.json().catch(() => ({}));
  const input = patchSchema.parse(body);

  const repo = new ProfilesRepository(await getDb());
  await repo.ensure(session);
  const profile = await repo.update(session.userId, {
    preferredLocale: input.preferredLocale,
    timezone: input.timezone,
    onboardingCompletedAt:
      input.onboardingCompleted === undefined
        ? undefined
        : input.onboardingCompleted
          ? new Date()
          : null,
  });
  return ok({ profile: serialize(profile) });
});

export const DELETE = withAuth(async (_request: Request, session: AuthSession) => {
  const repo = new ProfilesRepository(await getDb());
  await repo.ensure(session);
  await repo.delete(session.userId);
  return ok({ deleted: true });
});
