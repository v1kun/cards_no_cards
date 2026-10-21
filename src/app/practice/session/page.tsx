"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageHeader, ProgressBar, Spinner } from "@/components/ui";
import {
  isMultipleChoice,
  normalizeAnswer,
  type PracticeExercise,
} from "@/domain/review/exercises";
import type { SectionFilter } from "@/domain/review/session-plan";
import type { PracticeSnapshot } from "@/domain/review/snapshot";
import {
  allWordsLabel,
  labelLanguage,
  parseSection,
  partOfSpeechLabel,
  uncategorizedLabel,
} from "@/lib/client/labels";
import type { AnswerOutcome, SessionSummary } from "@/lib/client/offline-practice";
import type { PendingSession } from "@/lib/client/offline-store";
import { getPracticeEngine } from "@/lib/client/practice";

type Phase =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "empty" }
  | { kind: "active" }
  | { kind: "summary"; summary: SessionSummary };

function sectionTitle(snapshot: PracticeSnapshot, filter: SectionFilter): string {
  const lang = labelLanguage(snapshot.translationLanguage);
  switch (filter.kind) {
    case "all":
      return allWordsLabel(lang);
    case "topic":
      return filter.topicId === null
        ? uncategorizedLabel(lang)
        : (snapshot.topics.find((t) => t.id === filter.topicId)?.name ?? "Category");
    case "pos":
      return partOfSpeechLabel(filter.partOfSpeech, lang);
  }
}

function syncInBackground() {
  if (typeof navigator !== "undefined" && navigator.onLine) {
    void getPracticeEngine()
      .sync()
      .catch(() => undefined);
  }
}

function isAccepted(exercise: PracticeExercise, option: string): boolean {
  const value = normalizeAnswer(option);
  return exercise.acceptedAnswers.some((accepted) => normalizeAnswer(accepted) === value);
}

function hintFor(answer: string): string {
  return answer
    .split(" ")
    .map((part) => (part.length <= 1 ? part : `${part[0]}${"·".repeat(part.length - 1)}`))
    .join(" ");
}

function PracticeSession() {
  const params = useSearchParams();
  const filter = useMemo(() => parseSection(params), [params]);

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [snapshot, setSnapshot] = useState<PracticeSnapshot | null>(null);
  const [exercises, setExercises] = useState<PracticeExercise[]>([]);
  const [session, setSession] = useState<PendingSession | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [usedHint, setUsedHint] = useState(false);
  const [outcome, setOutcome] = useState<AnswerOutcome | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const shownAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const start = useCallback(async () => {
    setPhase({ kind: "loading" });
    const engine = getPracticeEngine();
    let saved = await engine.load().catch(() => null);
    if (!saved) saved = await engine.refresh().catch(() => null);
    if (!saved) {
      setPhase({ kind: "missing" });
      return;
    }
    const planned = engine.plan(saved, filter);
    setSnapshot(saved);
    setExercises(planned);
    setIndex(0);
    setAnswer("");
    setChosen(null);
    setUsedHint(false);
    setOutcome(null);
    if (planned.length === 0) {
      setPhase({ kind: "empty" });
      return;
    }
    setSession(engine.startSession());
    shownAt.current = Date.now();
    setPhase({ kind: "active" });
  }, [filter]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    window.addEventListener("online", syncInBackground);
    return () => window.removeEventListener("online", syncInBackground);
  }, []);

  const current = exercises[index];
  const word = useMemo(
    () => snapshot?.words.find((w) => w.id === current?.vocabularyItemId) ?? null,
    [snapshot, current],
  );

  useEffect(() => {
    if (outcome) nextRef.current?.focus();
    else inputRef.current?.focus();
  }, [outcome, index]);

  const submit = useCallback(
    async (input: { answer?: string; skipped?: boolean }) => {
      if (!session || !current || outcome || submitting) return;
      setSubmitting(true);
      try {
        const result = await getPracticeEngine().answer(session, current, {
          answer: input.skipped ? null : (input.answer ?? answer),
          usedHint,
          skipped: input.skipped ?? false,
          latencyMs: Date.now() - shownAt.current,
        });
        setOutcome(result);
        syncInBackground();
      } finally {
        setSubmitting(false);
      }
    },
    [session, current, outcome, submitting, answer, usedHint],
  );

  const next = useCallback(async () => {
    if (!session) return;
    if (index + 1 >= exercises.length) {
      const summary = await getPracticeEngine().finish(session);
      syncInBackground();
      setPhase({ kind: "summary", summary });
      return;
    }
    setIndex(index + 1);
    setAnswer("");
    setChosen(null);
    setUsedHint(false);
    setOutcome(null);
    shownAt.current = Date.now();
  }, [session, index, exercises.length]);

  const choose = useCallback(
    (option: string) => {
      setChosen(option);
      void submit({ answer: option });
    },
    [submit],
  );

  // Keyboard: 1–4 pick an option, Enter continues after feedback.
  useEffect(() => {
    if (phase.kind !== "active" || !current) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (outcome && event.key === "Enter" && document.activeElement !== nextRef.current) {
        event.preventDefault();
        void next();
        return;
      }
      if (!outcome && current.options && isMultipleChoice(current.exerciseType)) {
        const n = Number(event.key);
        const option = current.options[n - 1];
        if (Number.isInteger(n) && option) choose(option);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.kind, current, outcome, next, choose]);

  const title = snapshot ? sectionTitle(snapshot, filter) : "Practice";

  if (phase.kind === "loading") {
    return (
      <main>
        <PageHeader title={title} back={{ href: "/practice", label: "Sections" }} />
        <p className="muted row center">
          <Spinner /> Preparing your session…
        </p>
      </main>
    );
  }

  if (phase.kind === "missing") {
    return (
      <main>
        <PageHeader title="Practice" back={{ href: "/practice", label: "Sections" }} />
        <section className="card empty-state">
          <span className="emoji" aria-hidden="true">
            📶
          </span>
          <h2>No saved words yet</h2>
          <p className="muted">Open Practice once while online to download your vocabulary.</p>
          <button type="button" onClick={() => void start()}>
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (phase.kind === "empty") {
    return (
      <main>
        <PageHeader title={title} back={{ href: "/practice", label: "Sections" }} />
        <section className="card empty-state">
          <span className="emoji" aria-hidden="true">
            ✅
          </span>
          <h2>All caught up</h2>
          <p className="muted">
            Nothing in this section is due right now and there are no new words to introduce.
          </p>
          <Link className="button" href="/practice">
            Choose another section
          </Link>
        </section>
      </main>
    );
  }

  if (phase.kind === "summary") {
    const { summary } = phase;
    const correct = summary.recalled + summary.recalledWithHint;
    return (
      <main>
        <PageHeader title="Session complete" back={{ href: "/practice", label: "Sections" }} />
        <section className="card hero stack-lg">
          <div className="center stack" style={{ gap: "0.25rem" }}>
            <span style={{ fontSize: "2.5rem" }} aria-hidden="true">
              {summary.wrong === 0 && summary.skipped === 0 ? "🎉" : "💪"}
            </span>
            <h2>
              {correct} of {summary.totalAttempts} correct
            </h2>
            <p className="muted">
              {summary.wordsPracticed} word{summary.wordsPracticed === 1 ? "" : "s"} in “{title}”
            </p>
          </div>
          <div className="stats">
            <div className="stat">
              <strong>{summary.recalled}</strong>
              <span>Recalled</span>
            </div>
            <div className="stat">
              <strong>{summary.recalledWithHint}</strong>
              <span>With hint</span>
            </div>
            <div className="stat">
              <strong>{summary.wrong}</strong>
              <span>Wrong</span>
            </div>
            <div className="stat">
              <strong>{summary.skipped}</strong>
              <span>Skipped</span>
            </div>
          </div>
          <div className="row center">
            <button type="button" className="large" onClick={() => void start()}>
              Practice again
            </button>
            <Link className="button secondary large" href="/practice">
              Other sections
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (!current) return null;

  const multipleChoice = isMultipleChoice(current.exerciseType) && Boolean(current.options);
  const sentence = current.exerciseType === "cloze";

  return (
    <main>
      <PageHeader title={title} back={{ href: "/practice", label: "Sections" }}>
        <span className="muted small">
          {index + 1} / {exercises.length}
        </span>
      </PageHeader>
      <ProgressBar
        value={index + (outcome ? 1 : 0)}
        max={exercises.length}
        label="Session progress"
      />

      <section className="card exercise" aria-live="polite">
        <div className="row center" style={{ justifyContent: "center" }}>
          {current.isNew ? <span className="badge warn">New word</span> : null}
        </div>
        <p className="exercise-instruction">{current.instruction}</p>
        <p
          className={`exercise-prompt${sentence ? " sentence" : ""}`}
          lang={sentence ? "es" : undefined}
        >
          {current.promptText}
        </p>

        {multipleChoice ? (
          <div className="options">
            {current.options!.map((option, i) => {
              const accepted = isAccepted(current, option);
              const state = outcome
                ? accepted
                  ? " correct"
                  : option === chosen
                    ? " wrong"
                    : " dimmed"
                : "";
              return (
                <button
                  key={option}
                  type="button"
                  className={`option${state}`}
                  disabled={Boolean(outcome) || submitting}
                  onClick={() => choose(option)}
                >
                  <kbd aria-hidden="true">{i + 1}</kbd>
                  {option}
                </button>
              );
            })}
          </div>
        ) : (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (!outcome && answer.trim()) void submit({});
            }}
          >
            <input
              ref={inputRef}
              className="answer-input"
              type="text"
              lang="es"
              value={answer}
              disabled={Boolean(outcome)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Type your answer"
              aria-label="Your answer"
              onChange={(event) => setAnswer(event.target.value)}
            />
            {usedHint && !outcome ? (
              <p className="hint" aria-live="polite">
                Hint: <strong>{hintFor(current.correctAnswer)}</strong>
                {word?.secondaryTranslation ? ` · ${word.secondaryTranslation}` : ""}
              </p>
            ) : null}
            {!outcome ? (
              <div className="row center">
                <button
                  type="submit"
                  className="large"
                  style={{ flex: "1 1 auto" }}
                  disabled={submitting || answer.trim().length === 0}
                >
                  Check
                </button>
                <button
                  type="button"
                  className="secondary large"
                  disabled={usedHint || submitting}
                  onClick={() => setUsedHint(true)}
                >
                  💡 Hint
                </button>
              </div>
            ) : null}
          </form>
        )}

        {outcome ? (
          <div className={`feedback ${outcome.correct ? "correct" : "wrong"}`} role="status">
            <strong>
              {outcome.correct
                ? outcome.result === "recalled_with_hint"
                  ? "Correct (with hint)"
                  : "Correct!"
                : outcome.result === "skipped"
                  ? "Skipped"
                  : "Not quite"}
            </strong>
            {!outcome.correct || current.exerciseType !== "multiple_choice" ? (
              <span>
                Answer: <strong>{outcome.correctAnswer}</strong>
              </span>
            ) : null}
            {word &&
            word.lemma !== outcome.correctAnswer &&
            word.translation !== outcome.correctAnswer ? (
              <span className="muted small">
                {word.lemma} = {word.translation}
                {word.secondaryTranslation ? ` · ${word.secondaryTranslation}` : ""}
              </span>
            ) : null}
            {outcome.exampleSentence ? (
              <span className="muted small">
                <span lang="es">{outcome.exampleSentence}</span>
                {outcome.exampleTranslation ? ` — ${outcome.exampleTranslation}` : ""}
              </span>
            ) : null}
          </div>
        ) : null}

        {outcome ? (
          <button ref={nextRef} type="button" className="large block" onClick={() => void next()}>
            {index + 1 >= exercises.length ? "Finish" : "Next →"}
          </button>
        ) : (
          <button
            type="button"
            className="ghost"
            disabled={submitting}
            onClick={() => void submit({ skipped: true })}
          >
            I don’t know — skip
          </button>
        )}
      </section>
    </main>
  );
}

export default function PracticeSessionPage() {
  return (
    <Suspense
      fallback={
        <main>
          <p className="muted">Loading…</p>
        </main>
      }
    >
      <PracticeSession />
    </Suspense>
  );
}
