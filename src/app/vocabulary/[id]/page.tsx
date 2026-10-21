"use client";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/ui";
import { ApiClientError } from "@/lib/client/api";
import {
  archiveVocabulary,
  deleteVocabulary,
  getVocabulary,
  PARTS_OF_SPEECH,
  restoreVocabulary,
  updateVocabulary,
  type PartOfSpeech,
  type VocabularyDetailDto,
} from "@/lib/client/vocabulary";

type EditState = {
  lemma: string;
  translation: string;
  partOfSpeech: PartOfSpeech;
  definition: string;
  exampleSentence: string;
  exampleTranslation: string;
  topics: string;
};

function toEditState(item: VocabularyDetailDto): EditState {
  return {
    lemma: item.lemma,
    translation: item.translation,
    partOfSpeech: item.partOfSpeech,
    definition: item.definition ?? "",
    exampleSentence: item.exampleSentence ?? "",
    exampleTranslation: item.exampleTranslation ?? "",
    topics: item.topics.map((t) => t.name).join(", "),
  };
}

export default function VocabularyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [item, setItem] = useState<VocabularyDetailDto | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getVocabulary(id);
      setItem(res.item);
      setEdit(toEditState(res.item));
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        setError("This word was not found.");
      } else {
        setError(err instanceof ApiClientError ? err.message : "Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(event: React.FormEvent) {
    event.preventDefault();
    if (!edit) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await updateVocabulary(id, {
        lemma: edit.lemma.trim(),
        translation: edit.translation.trim(),
        partOfSpeech: edit.partOfSpeech,
        definition: edit.definition.trim() || null,
        exampleSentence: edit.exampleSentence.trim() || null,
        exampleTranslation: edit.exampleTranslation.trim() || null,
        topics: edit.topics
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setItem(res.item);
      setEdit(toEditState(res.item));
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function onArchiveToggle() {
    if (!item) return;
    setActionError(null);
    try {
      const res =
        item.status === "archived" ? await restoreVocabulary(id) : await archiveVocabulary(id);
      setItem(res.item);
      setEdit(toEditState(res.item));
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Action failed.");
    }
  }

  async function onDelete() {
    if (!window.confirm("Permanently delete this word and its history? This cannot be undone.")) {
      return;
    }
    setActionError(null);
    try {
      await deleteVocabulary(id);
      router.push("/vocabulary");
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Could not delete the word.");
    }
  }

  if (loading) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (error || !item || !edit) {
    return (
      <main>
        <PageHeader title="Word" back={{ href: "/vocabulary", label: "Vocabulary" }} />
        <div className="error-box">
          <p className="error">{error ?? "This word is unavailable."}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  const review = item.reviewSummary;

  return (
    <main>
      <PageHeader
        title={
          <>
            {item.lemma} {item.status === "archived" && <span className="tag warn">archived</span>}
          </>
        }
        back={{ href: "/vocabulary", label: "Vocabulary" }}
      />

      <section className="card" aria-label="Edit word">
        <h2>Edit</h2>
        <form onSubmit={onSave} className="stack">
          <div className="row">
            <label className="field">
              <span>Lemma</span>
              <input
                required
                value={edit.lemma}
                onChange={(e) => setEdit({ ...edit, lemma: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Translation</span>
              <input
                required
                value={edit.translation}
                onChange={(e) => setEdit({ ...edit, translation: e.target.value })}
              />
            </label>
          </div>
          <div className="row">
            <label className="field">
              <span>Part of speech</span>
              <select
                value={edit.partOfSpeech}
                onChange={(e) => setEdit({ ...edit, partOfSpeech: e.target.value as PartOfSpeech })}
              >
                {PARTS_OF_SPEECH.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Topics (comma-separated)</span>
              <input
                value={edit.topics}
                onChange={(e) => setEdit({ ...edit, topics: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>Definition</span>
            <input
              value={edit.definition}
              onChange={(e) => setEdit({ ...edit, definition: e.target.value })}
            />
          </label>
          <div className="row">
            <label className="field">
              <span>Example sentence</span>
              <input
                value={edit.exampleSentence}
                onChange={(e) => setEdit({ ...edit, exampleSentence: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Example translation</span>
              <input
                value={edit.exampleTranslation}
                onChange={(e) => setEdit({ ...edit, exampleTranslation: e.target.value })}
              />
            </label>
          </div>
          {actionError && <p className="error">{actionError}</p>}
          <div className="row">
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button type="button" className="secondary" onClick={() => void onArchiveToggle()}>
              {item.status === "archived" ? "Restore" : "Archive"}
            </button>
            <button type="button" className="danger" onClick={() => void onDelete()}>
              Delete
            </button>
          </div>
        </form>
      </section>

      <section className="card" aria-label="Forms">
        <h2>Forms</h2>
        {item.forms.length === 0 ? (
          <p className="muted">No forms recorded.</p>
        ) : (
          <ul className="list">
            {item.forms.map((form) => (
              <li key={form.id}>
                <strong>{form.form}</strong>
                {form.formType && <span className="muted"> · {form.formType}</span>}
                {form.grammarNote && <span className="muted"> — {form.grammarNote}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-label="Sources">
        <h2>Sources</h2>
        {item.sources.length === 0 ? (
          <p className="muted">No sources recorded.</p>
        ) : (
          <ul className="list">
            {item.sources.map((source) => (
              <li key={source.id}>
                <span className="tag ghost">{source.sourceType}</span>
                {source.sourceText && <span> {source.sourceText}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-label="Review summary">
        <h2>Review</h2>
        {review ? (
          <ul className="list">
            <li>Stage: {review.reviewStage}</li>
            <li>Successful recalls: {review.successfulRecalls}</li>
            <li>Consecutive failures: {review.consecutiveFailures}</li>
            <li>Due: {review.dueAt ? new Date(review.dueAt).toLocaleString() : "not scheduled"}</li>
            <li>Last result: {review.lastResult ?? "—"}</li>
          </ul>
        ) : (
          <p className="muted">Not yet introduced to review.</p>
        )}
      </section>
    </main>
  );
}
