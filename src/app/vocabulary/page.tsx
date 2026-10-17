"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApiClientError } from "@/lib/client/api";
import {
  createVocabulary,
  listTopics,
  listVocabulary,
  PARTS_OF_SPEECH,
  type PartOfSpeech,
  type TopicDto,
  type VocabularyFilters,
  type VocabularyListItemDto,
  type VocabularyStatus,
} from "@/lib/client/vocabulary";

const PAGE_SIZE = 25;

const emptyCreate = {
  lemma: "",
  translation: "",
  partOfSpeech: "noun" as PartOfSpeech,
  topics: "",
};

export default function VocabularyPage() {
  const [items, setItems] = useState<VocabularyListItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [topics, setTopics] = useState<TopicDto[]>([]);

  const [search, setSearch] = useState("");
  const [partOfSpeech, setPartOfSpeech] = useState<PartOfSpeech | "">("");
  const [status, setStatus] = useState<VocabularyStatus | "">("active");
  const [topicId, setTopicId] = useState("");
  const [dueOnly, setDueOnly] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyCreate);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const filters: VocabularyFilters = {
    search: search.trim() || undefined,
    partOfSpeech: partOfSpeech || undefined,
    status: status || undefined,
    topicId: topicId || undefined,
    dueOnly: dueOnly || undefined,
    limit: PAGE_SIZE,
    offset,
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listVocabulary(filters);
      setItems(page.items);
      setTotal(page.pagination.total);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, partOfSpeech, status, topicId, dueOnly, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listTopics()
      .then((res) => setTopics(res.topics))
      .catch(() => setTopics([]));
  }, [items.length]);

  // Reset to the first page whenever a filter changes.
  useEffect(() => {
    setOffset(0);
  }, [search, partOfSpeech, status, topicId, dueOnly]);

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createVocabulary({
        lemma: form.lemma.trim(),
        translation: form.translation.trim(),
        partOfSpeech: form.partOfSpeech,
        topics: form.topics
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setForm(emptyCreate);
      setOffset(0);
      await load();
    } catch (err) {
      setCreateError(err instanceof ApiClientError ? err.message : "Could not create the word.");
    } finally {
      setCreating(false);
    }
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main>
      <p>
        <Link href="/">← Home</Link>
        {" · "}
        <Link href="/import">Import from notes →</Link>
      </p>
      <h1>Vocabulary</h1>

      <section className="card" aria-label="Add a word">
        <h2>Add a word</h2>
        <form onSubmit={onCreate} className="stack">
          <div className="row">
            <label className="field">
              <span>Lemma</span>
              <input
                required
                value={form.lemma}
                onChange={(e) => setForm({ ...form, lemma: e.target.value })}
                placeholder="hablar"
              />
            </label>
            <label className="field">
              <span>Translation</span>
              <input
                required
                value={form.translation}
                onChange={(e) => setForm({ ...form, translation: e.target.value })}
                placeholder="to speak"
              />
            </label>
          </div>
          <div className="row">
            <label className="field">
              <span>Part of speech</span>
              <select
                value={form.partOfSpeech}
                onChange={(e) => setForm({ ...form, partOfSpeech: e.target.value as PartOfSpeech })}
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
                value={form.topics}
                onChange={(e) => setForm({ ...form, topics: e.target.value })}
                placeholder="Verbs, Daily life"
              />
            </label>
          </div>
          {createError && <p className="error">{createError}</p>}
          <div>
            <button type="submit" disabled={creating}>
              {creating ? "Adding…" : "Add word"}
            </button>
          </div>
        </form>
      </section>

      <section className="card" aria-label="Filters">
        <div className="row">
          <label className="field">
            <span>Search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search lemma…"
            />
          </label>
          <label className="field">
            <span>Part of speech</span>
            <select
              value={partOfSpeech}
              onChange={(e) => setPartOfSpeech(e.target.value as PartOfSpeech | "")}
            >
              <option value="">All</option>
              {PARTS_OF_SPEECH.map((pos) => (
                <option key={pos} value={pos}>
                  {pos}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field">
            <span>Topic</span>
            <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              <option value="">All</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as VocabularyStatus | "")}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="">All</option>
            </select>
          </label>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} />
          <span>Due only</span>
        </label>
      </section>

      <section aria-label="Results" aria-busy={loading}>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : error ? (
          <div className="error-box">
            <p className="error">{error}</p>
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="muted">No words match these filters yet. Add your first word above.</p>
        ) : (
          <>
            <ul className="list">
              {items.map((item) => (
                <li key={item.id} className="list-item">
                  <Link href={`/vocabulary/${item.id}`} className="list-link">
                    <strong>{item.lemma}</strong> — {item.translation}
                  </Link>
                  <div className="meta">
                    <span className="tag">{item.partOfSpeech}</span>
                    {item.status === "archived" && <span className="tag warn">archived</span>}
                    {item.topics.map((topic) => (
                      <span key={topic.id} className="tag ghost">
                        {topic.name}
                      </span>
                    ))}
                    {item.reviewSummary?.dueAt && (
                      <span className="muted">
                        due {new Date(item.reviewSummary.dueAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="pager">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </button>
              <span className="muted">
                Page {page} of {pageCount} · {total} total
              </span>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
