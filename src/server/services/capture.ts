import { z } from "zod";

import type { AIProvider } from "@/server/ai/types";
import type { Database } from "@/server/db/client";
import { ImportRepository } from "@/server/repositories/imports";
import { ReviewRepository } from "@/server/repositories/review";

/** Upper bound on dictated text, keeping voice captures short and cheap. */
const MAX_CAPTURE_LENGTH = 1000;

export const captureSchema = z.object({
  text: z.string().trim().min(1).max(MAX_CAPTURE_LENGTH),
});

export type CaptureInput = z.input<typeof captureSchema>;

export type CapturedWord = { lemma: string; translation: string | null };

export type CaptureResult = {
  batchId: string;
  status: string;
  count: number;
  words: CapturedWord[];
  /** A short, speakable sentence for Siri/Shortcuts to read back. */
  message: string;
};

export type ReviewSummary = {
  due: number;
  new: number;
  message: string;
};

/**
 * Thin orchestration for voice/Shortcuts entry points. Dictated text is routed
 * through the existing import pipeline (tagged as a `voice` source) so parsing,
 * review, and confirmation stay identical to the manual import flow. No new
 * authentication or token system is introduced: callers are authenticated by
 * the same `AuthProvider` as every other route.
 */
export class CaptureService {
  private readonly imports: ImportRepository;
  private readonly reviews: ReviewRepository;

  constructor(
    db: Database,
    private readonly provider: AIProvider,
  ) {
    this.imports = new ImportRepository(db);
    this.reviews = new ReviewRepository(db);
  }

  /** Captures dictated text into a `voice`-sourced import batch. */
  async capture(userId: string, input: CaptureInput): Promise<CaptureResult> {
    const { text } = captureSchema.parse(input);

    const batch = await this.imports.create(userId, { rawText: text, sourceType: "voice" });
    const processed = await this.imports.process(userId, batch.id, this.provider);

    const words: CapturedWord[] = processed.items.map((item) => ({
      lemma: item.proposedLemma ?? "",
      translation: item.proposedTranslation,
    }));

    return {
      batchId: processed.id,
      status: processed.status,
      count: words.length,
      words,
      message: captureMessage(words, processed.status),
    };
  }

  /** A speakable summary of what is waiting to be practiced. */
  async reviewSummary(userId: string, now: Date = new Date()): Promise<ReviewSummary> {
    const [due, fresh] = await Promise.all([
      this.reviews.countDue(userId, now),
      this.reviews.countNew(userId),
    ]);
    return { due, new: fresh, message: summaryMessage(due, fresh) };
  }
}

function captureMessage(words: CapturedWord[], status: string): string {
  if (words.length === 0 || status === "failed") {
    return "I couldn't capture any words. Please try again.";
  }
  const names = words
    .map((word) => word.lemma)
    .filter((lemma) => lemma.length > 0)
    .slice(0, 5)
    .join(", ");
  const noun = words.length === 1 ? "word" : "words";
  return `Captured ${words.length} ${noun}: ${names}. Review them in Cards No Cards.`;
}

function summaryMessage(due: number, fresh: number): string {
  if (due === 0 && fresh === 0) {
    return "Nothing is due and there are no new words. You're all caught up.";
  }
  const parts: string[] = [];
  if (due > 0) parts.push(`${due} due for review`);
  if (fresh > 0) parts.push(`${fresh} new`);
  return `You have ${parts.join(" and ")}. Say the word to start practicing.`;
}
