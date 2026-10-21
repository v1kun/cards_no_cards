/**
 * The offline practice snapshot shared by the server (which builds it) and
 * the client (which practices from it), plus the state transition applied
 * for every answer on both sides so their schedules agree.
 */
import type { BankItem } from "./bank";
import { nextSchedulingState, type ReviewResult, type SchedulingState } from "./schedule";
import type { PlanWord } from "./session-plan";

export type SnapshotWord = PlanWord & {
  secondaryTranslation: string | null;
  exampleTranslation: string | null;
  gender: string | null;
};

/** Scheduling state with timestamps in epoch ms (JSON/IndexedDB friendly). */
export type SnapshotState = {
  vocabularyItemId: string;
  dueAt: number | null;
  introducedAt: number | null;
  successfulRecalls: number;
  consecutiveFailures: number;
  reviewStage: number;
  difficulty: number;
  lastResult: ReviewResult | null;
  lastReviewedAt: number | null;
};

export type PracticeSnapshot = {
  serverTime: number;
  translationLanguage: string;
  words: SnapshotWord[];
  states: SnapshotState[];
  bank: BankItem[];
  topics: { id: string; name: string }[];
};

const toDate = (ms: number | null) => (ms === null ? null : new Date(ms));

export function fromSnapshotState(state: SnapshotState): SchedulingState {
  return {
    dueAt: toDate(state.dueAt),
    introducedAt: toDate(state.introducedAt),
    successfulRecalls: state.successfulRecalls,
    consecutiveFailures: state.consecutiveFailures,
    reviewStage: state.reviewStage,
    difficulty: state.difficulty,
    lastResult: state.lastResult,
    lastReviewedAt: toDate(state.lastReviewedAt),
  };
}

export function toSnapshotState(vocabularyItemId: string, state: SchedulingState): SnapshotState {
  return {
    vocabularyItemId,
    dueAt: state.dueAt?.getTime() ?? null,
    introducedAt: state.introducedAt?.getTime() ?? null,
    successfulRecalls: state.successfulRecalls,
    consecutiveFailures: state.consecutiveFailures,
    reviewStage: state.reviewStage,
    difficulty: state.difficulty,
    lastResult: state.lastResult,
    lastReviewedAt: state.lastReviewedAt?.getTime() ?? null,
  };
}

export function statesMap(states: SnapshotState[]): Map<string, SchedulingState> {
  return new Map(states.map((state) => [state.vocabularyItemId, fromSnapshotState(state)]));
}

/**
 * Applies one answer. An answer recorded offline may arrive after a newer
 * one; it is then applied at the latest review time so the schedule never
 * moves backwards.
 */
export function applyAnswer(
  state: SchedulingState,
  result: ReviewResult,
  answeredAt: number,
): SchedulingState {
  const at = Math.max(answeredAt, state.lastReviewedAt?.getTime() ?? 0);
  return nextSchedulingState(state, result, new Date(at));
}
