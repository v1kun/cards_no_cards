import { gradeAnswer, type PracticeExercise } from "@/domain/review/exercises";
import { initialSchedulingState, type ReviewResult } from "@/domain/review/schedule";
import {
  planSession,
  summarizeSections,
  type SectionFilter,
  type SectionSummary,
} from "@/domain/review/session-plan";
import {
  applyAnswer,
  fromSnapshotState,
  statesMap,
  toSnapshotState,
  type PracticeSnapshot,
  type SnapshotState,
} from "@/domain/review/snapshot";
import type { OfflineStore, PendingAttempt, PendingSession } from "./offline-store";

export type SyncRequest = {
  sessions: PendingSession[];
  attempts: Omit<PendingAttempt, "result">[];
};

export type SyncResponse = {
  accepted: { attemptId: string; result: ReviewResult; duplicate: boolean }[];
  rejected: { attemptId: string; reason: string }[];
  states: SnapshotState[];
  serverTime: number;
};

/** Network transport, injectable for tests. Errors carry an HTTP `status` (0 = offline). */
export type OfflineApi = {
  fetchSnapshot(): Promise<PracticeSnapshot>;
  sync(body: SyncRequest): Promise<SyncResponse>;
};

export type AnswerInput = {
  answer?: string | null;
  usedHint?: boolean;
  skipped?: boolean;
  latencyMs?: number | null;
};

export type AnswerOutcome = {
  result: ReviewResult;
  correct: boolean;
  correctAnswer: string;
  exampleSentence: string | null;
  exampleTranslation: string | null;
};

export type SessionSummary = {
  wordsPracticed: number;
  totalAttempts: number;
  recalled: number;
  recalledWithHint: number;
  wrong: number;
  skipped: number;
};

const SYNC_BATCH = 200;

function toSyncAttempt(attempt: PendingAttempt): SyncRequest["attempts"][number] {
  return {
    attemptId: attempt.attemptId,
    sessionId: attempt.sessionId,
    vocabularyItemId: attempt.vocabularyItemId,
    exerciseType: attempt.exerciseType,
    bankItemId: attempt.bankItemId,
    submittedAnswer: attempt.submittedAnswer,
    usedHint: attempt.usedHint,
    skipped: attempt.skipped,
    latencyMs: attempt.latencyMs,
    answeredAt: attempt.answeredAt,
  };
}

function errorStatus(error: unknown): number {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : 0;
}

/**
 * A UUID v4. `crypto.randomUUID` exists only in secure contexts (HTTPS or
 * localhost), so opening the app over plain HTTP on the LAN falls back to
 * `getRandomValues`, which is available everywhere.
 */
export function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The client-side practice engine. Practice reads only the local snapshot,
 * so it works fully offline; answers go to a durable outbox that is synced
 * whenever the network allows. All store mutations are serialized.
 */
export class OfflinePractice {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: OfflineStore,
    private readonly api: OfflineApi,
    private readonly clock: () => number = () => Date.now(),
    private readonly newId: () => string = randomId,
  ) {}

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** The locally stored snapshot, or null before the first download. */
  load(): Promise<PracticeSnapshot | null> {
    return this.store.getSnapshot();
  }

  /** Downloads a fresh snapshot and re-applies answers not yet synced. */
  refresh(): Promise<PracticeSnapshot> {
    return this.exclusive(async () => {
      const remote = await this.api.fetchSnapshot();
      const pending = await this.store.listAttempts();
      const snapshot = { ...remote, states: replay(remote.states, pending) };
      await this.store.putSnapshot(snapshot);
      return snapshot;
    });
  }

  sections(snapshot: PracticeSnapshot, uncategorizedName?: string): SectionSummary {
    return summarizeSections({
      words: snapshot.words,
      states: statesMap(snapshot.states),
      topics: snapshot.topics,
      now: new Date(this.clock()),
      uncategorizedName,
    });
  }

  plan(snapshot: PracticeSnapshot, filter: SectionFilter): PracticeExercise[] {
    return planSession({
      words: snapshot.words,
      states: statesMap(snapshot.states),
      bank: snapshot.bank,
      now: new Date(this.clock()),
      filter,
    });
  }

  private readonly sessionResults = new Map<
    string,
    Pick<PendingAttempt, "vocabularyItemId" | "result">[]
  >();

  startSession(): PendingSession {
    return { id: this.newId(), startedAt: this.clock(), finishedAt: null };
  }

  /** Grades locally, stores the answer in the outbox, and updates the schedule. */
  answer(
    session: PendingSession,
    exercise: PracticeExercise,
    input: AnswerInput,
  ): Promise<AnswerOutcome> {
    return this.exclusive(async () => {
      const result = gradeAnswer(exercise.acceptedAnswers, input.answer, {
        usedHint: input.usedHint,
        skipped: input.skipped,
      });
      const answeredAt = this.clock();
      const answer = input.skipped ? null : (input.answer?.trim() ?? null) || null;
      const results = this.sessionResults.get(session.id) ?? [];
      results.push({ vocabularyItemId: exercise.vocabularyItemId, result });
      this.sessionResults.set(session.id, results);
      await this.store.putSession(session);
      await this.store.putAttempt({
        attemptId: this.newId(),
        sessionId: session.id,
        vocabularyItemId: exercise.vocabularyItemId,
        exerciseType: exercise.exerciseType,
        bankItemId: exercise.bankItemId,
        submittedAnswer: answer,
        usedHint: input.usedHint ?? false,
        skipped: input.skipped ?? false,
        latencyMs: input.latencyMs ?? null,
        answeredAt,
        result,
      });

      const snapshot = await this.store.getSnapshot();
      const word = snapshot?.words.find((w) => w.id === exercise.vocabularyItemId);
      if (snapshot) {
        const states = statesMap(snapshot.states);
        const current = states.get(exercise.vocabularyItemId) ?? initialSchedulingState();
        const next = applyAnswer(current, result, answeredAt);
        snapshot.states = [
          ...snapshot.states.filter((s) => s.vocabularyItemId !== exercise.vocabularyItemId),
          toSnapshotState(exercise.vocabularyItemId, next),
        ];
        await this.store.putSnapshot(snapshot);
      }

      return {
        result,
        correct: result === "recalled" || result === "recalled_with_hint",
        correctAnswer: exercise.correctAnswer,
        exampleSentence: word?.exampleSentence ?? null,
        exampleTranslation: word?.exampleTranslation ?? null,
      };
    });
  }

  /** Marks the session finished and returns a local summary of its answers. */
  finish(session: PendingSession): Promise<SessionSummary> {
    return this.exclusive(async () => {
      const finished = { ...session, finishedAt: this.clock() };
      // Answers may already have been synced (and removed from the outbox),
      // so the summary comes from the in-memory record when available.
      const attempts =
        this.sessionResults.get(session.id) ??
        (await this.store.listAttempts()).filter((a) => a.sessionId === session.id);
      this.sessionResults.delete(session.id);
      if (attempts.length > 0) await this.store.putSession(finished);
      return summarize(attempts);
    });
  }

  async pendingCount(): Promise<number> {
    return (await this.store.listAttempts()).length;
  }

  /**
   * Sends the outbox to the server. Returns false when offline or on a
   * transient error (answers stay queued). Server states replace local ones,
   * with answers recorded meanwhile replayed on top.
   */
  sync(): Promise<{ ok: boolean; synced: number; rejected: number }> {
    return this.exclusive(async () => {
      let synced = 0;
      let rejected = 0;
      for (;;) {
        const pending = (await this.store.listAttempts()).slice(0, SYNC_BATCH);
        const sessions = await this.store.listSessions();
        if (pending.length === 0 && sessions.length === 0) break;

        let response: SyncResponse;
        try {
          response = await this.api.sync({
            sessions,
            attempts: pending.map(toSyncAttempt),
          });
        } catch (error) {
          // A malformed batch would block the outbox forever; drop it.
          if (errorStatus(error) === 400) {
            await this.store.deleteAttempts(pending.map((a) => a.attemptId));
            await this.store.deleteSessions(sessions.map((s) => s.id));
            rejected += pending.length;
            continue;
          }
          return { ok: false, synced, rejected };
        }

        const handled = [...response.accepted, ...response.rejected].map((a) => a.attemptId);
        await this.store.deleteAttempts(handled);
        await this.store.deleteSessions(sessions.map((s) => s.id));
        synced += response.accepted.length;
        rejected += response.rejected.length;

        const snapshot = await this.store.getSnapshot();
        if (snapshot && response.states.length > 0) {
          const remaining = await this.store.listAttempts();
          const updated = new Set(response.states.map((s) => s.vocabularyItemId));
          const rebased = replay(
            response.states,
            remaining.filter((a) => updated.has(a.vocabularyItemId)),
          );
          snapshot.states = [
            ...snapshot.states.filter((s) => !updated.has(s.vocabularyItemId)),
            ...rebased,
          ];
          await this.store.putSnapshot(snapshot);
        }
        if (handled.length === 0) break;
      }
      return { ok: true, synced, rejected };
    });
  }
}

/** Applies pending answers, oldest first, on top of server states. */
export function replay(states: SnapshotState[], pending: PendingAttempt[]): SnapshotState[] {
  const map = new Map(states.map((s) => [s.vocabularyItemId, fromSnapshotState(s)]));
  for (const attempt of [...pending].sort((a, b) => a.answeredAt - b.answeredAt)) {
    const current = map.get(attempt.vocabularyItemId) ?? initialSchedulingState();
    map.set(attempt.vocabularyItemId, applyAnswer(current, attempt.result, attempt.answeredAt));
  }
  return [...map.entries()].map(([id, state]) => toSnapshotState(id, state));
}

export function summarize(attempts: Pick<PendingAttempt, "vocabularyItemId" | "result">[]) {
  const counts = { recalled: 0, recalled_with_hint: 0, wrong: 0, skipped: 0 };
  for (const attempt of attempts) counts[attempt.result] += 1;
  return {
    wordsPracticed: new Set(attempts.map((a) => a.vocabularyItemId)).size,
    totalAttempts: attempts.length,
    recalled: counts.recalled,
    recalledWithHint: counts.recalled_with_hint,
    wrong: counts.wrong,
    skipped: counts.skipped,
  };
}
