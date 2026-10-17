import type { PracticeSession } from "@/server/repositories/review";

export function serializeSession(session: PracticeSession) {
  return {
    id: session.id,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    finishedAt: session.finishedAt ? session.finishedAt.toISOString() : null,
    targetDurationSeconds: session.targetDurationSeconds,
  };
}
