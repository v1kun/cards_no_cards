"use client";

import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "@/components/ui";
import { ApiClientError } from "@/lib/client/api";
import {
  confirmImport,
  createImport,
  reprocessImport,
  updateImportItems,
  type ConfirmResultDto,
  type ImportBatchDto,
  type ImportDecision,
  type ImportItemDto,
} from "@/lib/client/imports";
import { PARTS_OF_SPEECH, type PartOfSpeech } from "@/lib/client/vocabulary";

const SAMPLE = "hablar - to speak\ncomer - to eat\nla casa - the house\nrojo - red";

const DECISIONS: ImportDecision[] = ["create", "merge", "skip"];

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "Something went wrong.";
}

export default function ImportPage() {
  const [rawText, setRawText] = useState("");
  const [batch, setBatch] = useState<ImportBatchDto | null>(null);
  const [items, setItems] = useState<ImportItemDto[]>([]);
  const [result, setResult] = useState<ConfirmResultDto | null>(null);

  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setBatch(null);
    setItems([]);
    setResult(null);
    setError(null);
    setRawText("");
  };

  const parse = async () => {
    setParsing(true);
    setError(null);
    setResult(null);
    try {
      const created = await createImport({ rawText });
      setBatch(created);
      setItems(created.items);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setParsing(false);
    }
  };

  const reprocess = async () => {
    if (!batch) return;
    setParsing(true);
    setError(null);
    try {
      const reprocessed = await reprocessImport(batch.id);
      setBatch(reprocessed);
      setItems(reprocessed.items);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setParsing(false);
    }
  };

  const patchItem = (id: string, patch: Partial<ImportItemDto>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const confirm = async () => {
    if (!batch) return;
    setConfirming(true);
    setError(null);
    try {
      await updateImportItems(
        batch.id,
        items.map((item) => ({
          id: item.id,
          decision: item.decision,
          proposedLemma: item.proposedLemma,
          proposedTranslation: item.proposedTranslation,
          proposedPartOfSpeech: item.proposedPartOfSpeech,
          proposedTopics: item.proposedTopics,
        })),
      );
      const confirmed = await confirmImport(batch.id);
      setResult(confirmed);
      setBatch({ ...batch, status: confirmed.status });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setConfirming(false);
    }
  };

  const toReview = items.filter((item) => item.decision !== "skip").length;

  return (
    <main>
      <PageHeader title="Import vocabulary" back={{ href: "/vocabulary", label: "Vocabulary" }} />

      {result ? (
        <section className="card">
          <h2>Import confirmed</h2>
          <p>
            Created {result.createdVocabularyItemIds.length} new word(s) and enriched{" "}
            {result.mergedVocabularyItemIds.length} existing word(s).
          </p>
          <div className="row">
            <Link className="button" href="/vocabulary">
              View vocabulary
            </Link>
            <button type="button" onClick={reset}>
              Start a new import
            </button>
          </div>
        </section>
      ) : !batch ? (
        <section className="card stack">
          <p>
            Paste free-form lesson notes or a word list. Each line is parsed into an editable
            proposal you can correct before saving. Nothing is saved until you confirm.
          </p>
          <textarea
            rows={10}
            value={rawText}
            placeholder={SAMPLE}
            onChange={(event) => setRawText(event.target.value)}
          />
          <div className="row">
            <button
              type="button"
              className="button"
              disabled={parsing || rawText.trim().length === 0}
              onClick={parse}
            >
              {parsing ? "Parsing…" : "Parse text"}
            </button>
            <button type="button" onClick={() => setRawText(SAMPLE)} disabled={parsing}>
              Use sample
            </button>
          </div>
          {error ? <p className="error-box">{error}</p> : null}
        </section>
      ) : batch.status === "failed" ? (
        <section className="card stack">
          <p className="error-box">
            Parsing failed{batch.errorCode ? ` (${batch.errorCode})` : ""}. Your text was saved, so
            you can try again.
          </p>
          <div className="row">
            <button type="button" className="button" onClick={reprocess} disabled={parsing}>
              {parsing ? "Retrying…" : "Try again"}
            </button>
            <button type="button" onClick={reset}>
              Start over
            </button>
          </div>
        </section>
      ) : (
        <section className="stack">
          <p>
            Review {items.length} proposal(s). Duplicates of existing words are pre-set to{" "}
            <strong>merge</strong>; uncertain items are left for you to decide.
          </p>

          {items.length === 0 ? (
            <p className="error-box">No proposals were produced. Try different text.</p>
          ) : (
            <ul className="list">
              {items.map((item) => (
                <li key={item.id} className="card stack">
                  <div className="row">
                    <select
                      value={item.decision}
                      onChange={(event) =>
                        patchItem(item.id, { decision: event.target.value as ImportDecision })
                      }
                    >
                      {DECISIONS.map((decision) => (
                        <option key={decision} value={decision}>
                          {decision}
                        </option>
                      ))}
                    </select>
                    {item.matchVocabularyItemId ? (
                      <span className="tag">possible duplicate</span>
                    ) : null}
                    {item.confidence != null ? (
                      <span className="tag">confidence {Math.round(item.confidence * 100)}%</span>
                    ) : null}
                  </div>
                  <div className="row">
                    <label className="field">
                      Lemma
                      <input
                        value={item.proposedLemma ?? ""}
                        onChange={(event) =>
                          patchItem(item.id, { proposedLemma: event.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      Translation
                      <input
                        value={item.proposedTranslation ?? ""}
                        onChange={(event) =>
                          patchItem(item.id, { proposedTranslation: event.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      Part of speech
                      <select
                        value={item.proposedPartOfSpeech ?? "other"}
                        onChange={(event) =>
                          patchItem(item.id, {
                            proposedPartOfSpeech: event.target.value as PartOfSpeech,
                          })
                        }
                      >
                        {PARTS_OF_SPEECH.map((pos) => (
                          <option key={pos} value={pos}>
                            {pos}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="field">
                    Topics (comma-separated)
                    <input
                      value={item.proposedTopics.join(", ")}
                      onChange={(event) =>
                        patchItem(item.id, {
                          proposedTopics: event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter((value) => value.length > 0),
                        })
                      }
                    />
                  </label>
                </li>
              ))}
            </ul>
          )}

          {error ? <p className="error-box">{error}</p> : null}

          <div className="row">
            <button
              type="button"
              className="button"
              disabled={confirming || toReview === 0}
              onClick={confirm}
            >
              {confirming ? "Saving…" : `Confirm import (${toReview})`}
            </button>
            <button type="button" onClick={reprocess} disabled={parsing || confirming}>
              {parsing ? "Reparsing…" : "Reparse"}
            </button>
            <button type="button" onClick={reset} disabled={confirming}>
              Discard
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
