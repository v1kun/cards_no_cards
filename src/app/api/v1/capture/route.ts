import { ok, withAuth } from "@/lib/api/respond";
import { createAIProvider } from "@/server/ai/provider-factory";
import { getDb } from "@/server/db/connection";
import { CaptureService } from "@/server/services/capture";

/**
 * Voice/Shortcuts capture endpoint.
 *
 * `POST` adds dictated text as a `voice`-sourced import batch; `GET` returns a
 * speakable summary of what is due. Both reuse the standard request
 * authentication, so an Apple Shortcut only needs to reach an authenticated
 * session (locally, the dev provider authenticates every request).
 */
export const POST = withAuth(async (request, session) => {
  const body: unknown = await request.json().catch(() => ({}));
  const service = new CaptureService(await getDb(), createAIProvider());
  const result = await service.capture(session.userId, body as { text: string });

  return ok(result, 201);
});

export const GET = withAuth(async (_request, session) => {
  const service = new CaptureService(await getDb(), createAIProvider());
  const summary = await service.reviewSummary(session.userId);

  return ok(summary);
});
