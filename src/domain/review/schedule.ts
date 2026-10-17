/**
 * Deterministic review scheduling.
 *
 * All scheduling math lives here so it stays testable and free of UI or
 * database concerns. The AI model is never asked to choose review dates.
 */

export const reviewResultValues = ["recalled", "recalled_with_hint", "wrong", "skipped"] as const;

export type ReviewResult = (typeof reviewResultValues)[number];

/** Spacing ladder in days. `reviewStage` indexes into this list. */
export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30] as const;

/** How soon a wrong answer brings a word back (same session / very soon). */
export const RELAPSE_INTERVAL_MINUTES = 10;

/** How soon a skipped word is shown again. */
export const SKIP_INTERVAL_MINUTES = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Difficulty is clamped to this range; higher means harder for the learner. */
export const MIN_DIFFICULTY = 0;
export const MAX_DIFFICULTY = 1;
const DIFFICULTY_STEP = 0.1;

/** The mutable scheduling fields of a review state. */
export type SchedulingState = {
  dueAt: Date | null;
  introducedAt: Date | null;
  successfulRecalls: number;
  consecutiveFailures: number;
  reviewStage: number;
  difficulty: number;
  lastResult: ReviewResult | null;
  lastReviewedAt: Date | null;
};

/** A freshly introduced word that has never been scheduled. */
export function initialSchedulingState(): SchedulingState {
  return {
    dueAt: null,
    introducedAt: null,
    successfulRecalls: 0,
    consecutiveFailures: 0,
    reviewStage: 0,
    difficulty: 0.5,
    lastResult: null,
    lastReviewedAt: null,
  };
}

function clampStage(stage: number): number {
  if (stage < 0) return 0;
  const max = REVIEW_INTERVALS_DAYS.length - 1;
  return stage > max ? max : stage;
}

function clampDifficulty(value: number): number {
  if (value < MIN_DIFFICULTY) return MIN_DIFFICULTY;
  if (value > MAX_DIFFICULTY) return MAX_DIFFICULTY;
  return Math.round(value * 100) / 100;
}

function intervalMsForStage(stage: number): number {
  return (REVIEW_INTERVALS_DAYS[clampStage(stage)] ?? REVIEW_INTERVALS_DAYS[0]) * DAY_MS;
}

/**
 * Computes the next scheduling state from the current one and the result of a
 * single attempt. Pure and deterministic given `now`.
 *
 * Rules (see TECHNICAL_SPEC §6):
 * - `recalled` (independent): advances the spacing ladder a full step.
 * - `recalled_with_hint`: counts as a success but grows the interval less
 *   aggressively (the ladder does not advance).
 * - `wrong`: increments the failure count and schedules a much earlier review.
 * - `skipped`: neither success nor failure; the word is shown again soon.
 *
 * A single correct answer never "masters" a word: there is no terminal state
 * and intervals cap at the top of the ladder, so words always return.
 */
export function nextSchedulingState(
  current: SchedulingState,
  result: ReviewResult,
  now: Date = new Date(),
): SchedulingState {
  const introducedAt = current.introducedAt ?? now;

  switch (result) {
    case "recalled": {
      const reviewStage = clampStage(current.reviewStage + 1);
      return {
        introducedAt,
        dueAt: new Date(now.getTime() + intervalMsForStage(reviewStage)),
        successfulRecalls: current.successfulRecalls + 1,
        consecutiveFailures: 0,
        reviewStage,
        difficulty: clampDifficulty(current.difficulty - DIFFICULTY_STEP),
        lastResult: "recalled",
        lastReviewedAt: now,
      };
    }
    case "recalled_with_hint": {
      // Success, but the ladder does not advance so the next interval is shorter
      // than it would have been for an independent recall.
      const reviewStage = clampStage(current.reviewStage);
      return {
        introducedAt,
        dueAt: new Date(now.getTime() + intervalMsForStage(reviewStage)),
        successfulRecalls: current.successfulRecalls + 1,
        consecutiveFailures: 0,
        reviewStage,
        difficulty: clampDifficulty(current.difficulty - DIFFICULTY_STEP / 2),
        lastResult: "recalled_with_hint",
        lastReviewedAt: now,
      };
    }
    case "wrong": {
      const reviewStage = clampStage(current.reviewStage - 1);
      return {
        introducedAt,
        dueAt: new Date(now.getTime() + RELAPSE_INTERVAL_MINUTES * MINUTE_MS),
        successfulRecalls: current.successfulRecalls,
        consecutiveFailures: current.consecutiveFailures + 1,
        reviewStage,
        difficulty: clampDifficulty(current.difficulty + DIFFICULTY_STEP),
        lastResult: "wrong",
        lastReviewedAt: now,
      };
    }
    case "skipped": {
      return {
        introducedAt,
        dueAt: new Date(now.getTime() + SKIP_INTERVAL_MINUTES * MINUTE_MS),
        successfulRecalls: current.successfulRecalls,
        consecutiveFailures: current.consecutiveFailures,
        reviewStage: clampStage(current.reviewStage),
        difficulty: current.difficulty,
        lastResult: "skipped",
        lastReviewedAt: now,
      };
    }
  }
}
