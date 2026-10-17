"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { ApiClientError } from "@/lib/client/api";
import {
  completeReviewSession,
  startReviewSession,
  submitAttempt,
  type ExercisePromptDto,
  type GradedOutcomeDto,
  type PracticeSessionDto,
  type SessionSummaryDto,
} from "@/lib/client/practice";

type Phase = "idle" | "loading" | "active" | "empty" | "summary";

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "Something went wrong.";
}

const INSTRUCTION_HINT = "Need a nudge? Reveal a hint — it counts as an assisted recall.";

export default function PracticePage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<PracticeSessionDto | null>(null);
  const [exercises, setExercises] = useState<ExercisePromptDto[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [usedHint, setUsedHint] = useState(false);
  const [outcome, setOutcome] = useState<GradedOutcomeDto | null>(null);
  const [summary, setSummary] = useState<SessionSummaryDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = exercises[index];
  const attemptId = useMemo(
    () => (session && current ? `${session.id}:${index}` : null),
    [session, current, index],
  );

  const start = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const plan = await startReviewSession();
      if (!plan.session || plan.exercises.length === 0) {
        setPhase("empty");
        return;
      }
      setSession(plan.session);
      setExercises(plan.exercises);
      setIndex(0);
      setAnswer("");
      setUsedHint(false);
      setOutcome(null);
      setSummary(null);
      setPhase("active");
    } catch (caught) {
      setError(errorMessage(caught));
      setPhase("idle");
    }
  }, []);

  const finish = useCallback(async (activeSession: PracticeSessionDto) => {
    try {
      const completed = await completeReviewSession(activeSession.id);
      setSummary(completed.summary);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPhase("summary");
    }
  }, []);

  const grade = useCallback(
    async (options: { skipped?: boolean }) => {
      if (!session || !current) return;
      setSubmitting(true);
      setError(null);
      try {
        const result = await submitAttempt({
          sessionId: session.id,
          vocabularyItemId: current.vocabularyItemId,
          exerciseType: current.exerciseType,
          submittedAnswer: options.skipped ? undefined : answer,
          usedHint,
          skipped: options.skipped ?? false,
          attemptId: attemptId ?? undefined,
        });
        if (result.status === "uncertain") {
          // Uncertain evaluations do not punish; prompt the learner to retry.
          setError(`${result.feedback} Try rephrasing your answer.`);
          return;
        }
        setOutcome(result);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setSubmitting(false);
      }
    },
    [session, current, answer, usedHint, attemptId],
  );

  const next = useCallback(() => {
    setOutcome(null);
    setAnswer("");
    setUsedHint(false);
    setError(null);
    if (index + 1 >= exercises.length) {
      if (session) void finish(session);
      return;
    }
    setIndex((value) => value + 1);
  }, [index, exercises.length, session, finish]);

  if (phase === "idle" || phase === "loading") {
    return (
      <main>
        <div className="row">
          <h1>Practice</h1>
          <Link href="/">Home</Link>
        </div>
        <section className="card stack">
          <p>
            A short session mixes words that are due for review with a few new ones, targeting about
            three minutes. There is no timer.
          </p>
          <button type="button" className="button" onClick={start} disabled={phase === "loading"}>
            {phase === "loading" ? "Preparing…" : "Start session"}
          </button>
          {error ? <p className="error-box">{error}</p> : null}
        </section>
      </main>
    );
  }

  if (phase === "empty") {
    return (
      <main>
        <div className="row">
          <h1>Practice</h1>
          <Link href="/">Home</Link>
        </div>
        <section className="card stack">
          <p>Nothing is due right now, and there are no new words to introduce.</p>
          <p className="muted">
            Add words from <Link href="/vocabulary">your vocabulary</Link> or{" "}
            <Link href="/import">import</Link> a list, then come back to practice.
          </p>
          <button type="button" onClick={start}>
            Check again
          </button>
        </section>
      </main>
    );
  }

  if (phase === "summary" && summary) {
    return (
      <main>
        <div className="row">
          <h1>Session complete</h1>
          <Link href="/">Home</Link>
        </div>
        <section className="card stack">
          <p>
            You practiced {summary.wordsPracticed} word(s) across {summary.totalAttempts} answer(s).
          </p>
          <ul className="list">
            <li className="list-item">Independent recalls: {summary.recalled}</li>
            <li className="list-item">Hint-assisted: {summary.recalledWithHint}</li>
            <li className="list-item">Incorrect: {summary.wrong}</li>
            <li className="list-item">Skipped: {summary.skipped}</li>
          </ul>
          <div className="row">
            <button type="button" className="button" onClick={start}>
              Practice again
            </button>
            <Link href="/vocabulary">Back to vocabulary</Link>
          </div>
          {error ? <p className="error-box">{error}</p> : null}
        </section>
      </main>
    );
  }

  if (!current) {
    return null;
  }

  const progress = `${index + 1} / ${exercises.length}`;

  return (
    <main>
      <div className="row">
        <h1>Practice</h1>
        <span className="muted">{progress}</span>
      </div>

      <section className="card stack">
        <div className="row">
          <span className="tag ghost">{current.exerciseType.replace("_", " ")}</span>
          {current.isNew ? <span className="tag warn">new word</span> : null}
        </div>
        <p className="muted">{current.instruction}</p>
        <h2>{current.promptText}</h2>

        {outcome ? (
          <div className="stack">
            <p className={outcome.correct ? "tag" : "error-box"}>{outcome.feedback}</p>
            {outcome.reinforcement && !outcome.correct ? (
              <div className="card stack">
                <strong>Reinforcement</strong>
                <p>Correct answer: {outcome.reinforcement.correctAnswer}</p>
                {outcome.reinforcement.exampleSentence ? (
                  <p className="muted">
                    {outcome.reinforcement.exampleSentence}
                    {outcome.reinforcement.exampleTranslation
                      ? ` — ${outcome.reinforcement.exampleTranslation}`
                      : ""}
                  </p>
                ) : null}
              </div>
            ) : null}
            <button type="button" className="button" onClick={next}>
              {index + 1 >= exercises.length ? "Finish session" : "Next"}
            </button>
          </div>
        ) : current.exerciseType === "multiple_choice" && current.options ? (
          <div className="stack">
            {usedHint ? <p className="muted">{INSTRUCTION_HINT}</p> : null}
            {current.options.map((option) => (
              <button
                key={option}
                type="button"
                className="secondary"
                disabled={submitting}
                onClick={() => {
                  setAnswer(option);
                  void grade({ skipped: false });
                }}
              >
                {option}
              </button>
            ))}
            <div className="row">
              <button
                type="button"
                onClick={() => void grade({ skipped: true })}
                disabled={submitting}
              >
                Skip
              </button>
            </div>
          </div>
        ) : (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void grade({ skipped: false });
            }}
          >
            <input
              type="text"
              value={answer}
              autoComplete="off"
              placeholder="Type your answer"
              onChange={(event) => setAnswer(event.target.value)}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={usedHint}
                onChange={(event) => setUsedHint(event.target.checked)}
              />
              <span>I used a hint</span>
            </label>
            <div className="row">
              <button
                type="submit"
                className="button"
                disabled={submitting || answer.trim().length === 0}
              >
                {submitting ? "Checking…" : "Submit"}
              </button>
              <button
                type="button"
                onClick={() => void grade({ skipped: true })}
                disabled={submitting}
              >
                Skip
              </button>
            </div>
          </form>
        )}

        {error ? <p className="error-box">{error}</p> : null}
      </section>
    </main>
  );
}
