"use client";

import { apiFetch } from "./api";

export type ExerciseType = "multiple_choice" | "recall" | "cloze";

export type ReviewResult = "recalled" | "recalled_with_hint" | "wrong" | "skipped";

export type ExercisePromptDto = {
  vocabularyItemId: string;
  exerciseType: ExerciseType;
  instruction: string;
  promptText: string;
  options?: string[];
  isNew: boolean;
};

export type PracticeSessionDto = {
  id: string;
  status: "active" | "completed" | "abandoned";
  startedAt: string;
  finishedAt: string | null;
  targetDurationSeconds: number;
};

export type SessionPlanDto = {
  session: PracticeSessionDto | null;
  exercises: ExercisePromptDto[];
};

export type ReinforcementDto = {
  correctAnswer: string;
  exampleSentence: string | null;
  exampleTranslation: string | null;
};

export type GradedOutcomeDto = {
  status: "graded";
  result: ReviewResult;
  correct: boolean;
  feedback: string;
  correctAnswer: string;
  reinforcement: ReinforcementDto | null;
  nextDueAt: string | null;
  duplicate: boolean;
};

export type AttemptOutcomeDto = GradedOutcomeDto | { status: "uncertain"; feedback: string };

export type SessionSummaryDto = {
  sessionId: string;
  wordsPracticed: number;
  totalAttempts: number;
  recalled: number;
  recalledWithHint: number;
  wrong: number;
  skipped: number;
};

export function startReviewSession(): Promise<SessionPlanDto> {
  return apiFetch<SessionPlanDto>("/api/v1/review/session", { method: "POST" });
}

export function submitAttempt(input: {
  sessionId: string;
  vocabularyItemId: string;
  exerciseType: ExerciseType;
  submittedAnswer?: string;
  usedHint?: boolean;
  skipped?: boolean;
  latencyMs?: number;
  attemptId?: string;
}): Promise<AttemptOutcomeDto> {
  return apiFetch<AttemptOutcomeDto>("/api/v1/review/attempts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function completeReviewSession(
  id: string,
): Promise<{ session: PracticeSessionDto; summary: SessionSummaryDto }> {
  return apiFetch<{ session: PracticeSessionDto; summary: SessionSummaryDto }>(
    `/api/v1/review/session/${id}`,
    { method: "PATCH" },
  );
}
