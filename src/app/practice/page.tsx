"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConnectionStatus } from "@/components/ConnectionStatus";
import { PageHeader, SectionTile, SegmentedControl, Spinner } from "@/components/ui";
import type { SectionFilter } from "@/domain/review/session-plan";
import { ApiClientError } from "@/lib/client/api";
import {
  allWordsLabel,
  labelLanguage,
  partOfSpeechEmoji,
  partOfSpeechLabel,
  sectionQuery,
  topicEmoji,
  uncategorizedLabel,
} from "@/lib/client/labels";
import {
  getBankStatus,
  getPracticeEngine,
  refreshBank,
  type BankStatus,
} from "@/lib/client/practice";
import { usePracticeData } from "@/lib/client/use-practice";

type Grouping = "topics" | "pos";

const GROUPING_KEY = "cnc.practice.grouping";

function BankPanel({ onUpdated }: { onUpdated: () => Promise<void> }) {
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await getBankStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const generate = useCallback(async () => {
    if (!status) return;
    setRunning(true);
    setError(null);
    setFailed([]);
    const exclude: string[] = [];
    const failedLemmas: string[] = [];
    let done = 0;
    const total = status.pending;
    setProgress({ done, total });
    try {
      for (;;) {
        const result = await refreshBank(exclude);
        done += result.succeeded;
        for (const word of result.failed) {
          exclude.push(word.id);
          failedLemmas.push(word.lemma);
        }
        setProgress({ done, total });
        setFailed([...failedLemmas]);
        if (result.remaining === 0 || result.processed === 0) break;
        if (result.succeeded === 0 && result.failed.length === 0) break;
      }
      await onUpdated();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError && caught.status === 0
          ? "You are offline. Question generation needs a connection."
          : caught instanceof Error
            ? caught.message
            : "Generation failed.",
      );
    } finally {
      setRunning(false);
      setProgress(null);
      await loadStatus();
    }
  }, [status, onUpdated, loadStatus]);

  if (!status || status.totalWords === 0) return null;

  const fresh = status.pending === 0;
  return (
    <section className="card stack" aria-labelledby="bank-title">
      <div className="spread">
        <div className="stack" style={{ gap: "0.15rem" }}>
          <h2 id="bank-title">Question bank</h2>
          <p className="muted small">
            {fresh
              ? `Prepared questions for all ${status.totalWords} words — practice works offline.`
              : `${status.upToDate} of ${status.totalWords} words have prepared questions` +
                (status.stale ? ` (${status.stale} need an update after edits)` : "") +
                ". Others use simple built-in questions."}
          </p>
        </div>
        {fresh ? <span className="badge success">Up to date</span> : null}
      </div>
      {!fresh ? (
        <button type="button" className="secondary" onClick={generate} disabled={running}>
          {running ? <Spinner /> : <span aria-hidden="true">✨</span>}
          {running && progress
            ? `Generating… ${progress.done} / ${progress.total}`
            : `Generate questions for ${status.pending} word${status.pending === 1 ? "" : "s"}`}
        </button>
      ) : null}
      {failed.length > 0 ? (
        <p className="muted small">Could not generate for: {failed.join(", ")}. Try again later.</p>
      ) : null}
      {error ? <p className="error small">{error}</p> : null}
    </section>
  );
}

export default function PracticePage() {
  const router = useRouter();
  const { snapshot, loading, refreshing, pending, networkError, reload } = usePracticeData();
  const [grouping, setGrouping] = useState<Grouping>("topics");

  useEffect(() => {
    const saved = window.localStorage.getItem(GROUPING_KEY);
    if (saved === "topics" || saved === "pos") setGrouping(saved);
  }, []);

  const changeGrouping = (value: Grouping) => {
    setGrouping(value);
    window.localStorage.setItem(GROUPING_KEY, value);
  };

  const lang = labelLanguage(snapshot?.translationLanguage);
  const sections = useMemo(
    () => (snapshot ? getPracticeEngine().sections(snapshot, uncategorizedLabel(lang)) : null),
    [snapshot, lang],
  );

  const open = (filter: SectionFilter) => router.push(`/practice/session${sectionQuery(filter)}`);

  return (
    <main>
      <PageHeader title="Practice" back={{ href: "/", label: "Home" }} aside={<ConnectionStatus />}>
        {refreshing ? (
          <span className="muted small row center" style={{ gap: "0.4rem" }}>
            <Spinner /> Updating
          </span>
        ) : null}
      </PageHeader>

      {pending > 0 ? (
        <p className="notice warn small" role="status">
          {pending} answer{pending === 1 ? "" : "s"} waiting to sync. They will upload automatically
          when you are online.
        </p>
      ) : null}
      {networkError && snapshot ? <p className="muted small">{networkError}</p> : null}

      {loading ? (
        <p className="muted row center">
          <Spinner /> Loading…
        </p>
      ) : !snapshot || !sections ? (
        <section className="card empty-state">
          <span className="emoji" aria-hidden="true">
            📶
          </span>
          <h2>No saved practice data yet</h2>
          <p className="muted">
            Open this page once while online to download your words. After that, practice works
            offline.
          </p>
          {networkError ? <p className="error small">{networkError}</p> : null}
          <button type="button" onClick={() => void reload()} disabled={refreshing}>
            {refreshing ? <Spinner /> : null} Try again
          </button>
        </section>
      ) : sections.all.total === 0 ? (
        <section className="card empty-state">
          <span className="emoji" aria-hidden="true">
            🌱
          </span>
          <h2>Your vocabulary is empty</h2>
          <p className="muted">Add a few words or import a lesson to start practicing.</p>
          <div className="row center">
            <Link className="button" href="/vocabulary">
              Add words
            </Link>
            <Link className="button secondary" href="/import">
              Import a lesson
            </Link>
          </div>
        </section>
      ) : (
        <div className="stack-lg">
          <SectionTile
            featured
            emoji="🎯"
            title={allWordsLabel(lang)}
            counts={sections.all}
            onClick={() => open({ kind: "all" })}
          />

          <section className="stack" aria-label="Sections">
            <div className="spread">
              <span className="eyebrow">Choose a section</span>
              <SegmentedControl<Grouping>
                label="Group sections by"
                value={grouping}
                onChange={changeGrouping}
                options={[
                  { value: "topics", label: "Categories" },
                  { value: "pos", label: "Parts of speech" },
                ]}
              />
            </div>
            <div className="grid">
              {grouping === "topics"
                ? sections.topics.map((topic) => (
                    <SectionTile
                      key={topic.topicId ?? "none"}
                      emoji={topicEmoji(topic.name, topic.topicId === null)}
                      title={topic.name}
                      counts={topic.counts}
                      onClick={() => open({ kind: "topic", topicId: topic.topicId })}
                    />
                  ))
                : sections.partsOfSpeech.map((section) => (
                    <SectionTile
                      key={section.partOfSpeech}
                      emoji={partOfSpeechEmoji(section.partOfSpeech)}
                      title={partOfSpeechLabel(section.partOfSpeech, lang)}
                      counts={section.counts}
                      onClick={() => open({ kind: "pos", partOfSpeech: section.partOfSpeech })}
                    />
                  ))}
            </div>
          </section>

          <BankPanel onUpdated={reload} />
        </div>
      )}
    </main>
  );
}
