import { describe, expect, it } from "vitest";

import type { PracticeSnapshot, SnapshotState } from "@/domain/review/snapshot";
import {
  OfflinePractice,
  type OfflineApi,
  type SyncRequest,
  type SyncResponse,
} from "@/lib/client/offline-practice";
import { MemoryOfflineStore } from "@/lib/client/offline-store";

const NOW = Date.UTC(2025, 0, 10, 12);

function word(id: string, lemma: string, translation: string, topicIds: string[] = []) {
  return {
    id,
    lemma,
    translation,
    partOfSpeech: "noun",
    forms: [],
    exampleSentence: null,
    exampleTranslation: null,
    secondaryTranslation: null,
    gender: null,
    topicIds,
    createdAt: NOW - 1000,
  };
}

function snapshot(states: SnapshotState[] = []): PracticeSnapshot {
  return {
    serverTime: NOW,
    translationLanguage: "en",
    words: [
      word("w1", "casa", "house", ["t1"]),
      word("w2", "perro", "dog"),
      word("w3", "gato", "cat", ["t1"]),
    ],
    states,
    bank: [],
    topics: [{ id: "t1", name: "Home" }],
  };
}

class FakeApi implements OfflineApi {
  online = true;
  failStatus = 0;
  requests: SyncRequest[] = [];
  remote = snapshot();
  serverStates: SnapshotState[] = [];

  async fetchSnapshot() {
    if (!this.online) throw Object.assign(new Error("offline"), { status: 0 });
    return structuredClone(this.remote);
  }

  async sync(body: SyncRequest): Promise<SyncResponse> {
    if (!this.online) throw Object.assign(new Error("offline"), { status: 0 });
    if (this.failStatus) throw Object.assign(new Error("bad"), { status: this.failStatus });
    this.requests.push(structuredClone(body));
    return {
      accepted: body.attempts.map((a) => ({
        attemptId: a.attemptId,
        result: "recalled",
        duplicate: false,
      })),
      rejected: [],
      states: this.serverStates,
      serverTime: NOW,
    };
  }
}

function setup() {
  const store = new MemoryOfflineStore();
  const api = new FakeApi();
  let clock = NOW;
  let seq = 0;
  const engine = new OfflinePractice(
    store,
    api,
    () => clock,
    () => `id-${++seq}-xxxxxxxx`,
  );
  return { store, api, engine, tick: (ms: number) => (clock += ms) };
}

describe("OfflinePractice", () => {
  it("plans and practices entirely from the local snapshot", async () => {
    const { engine, api, store } = setup();
    await engine.refresh();
    api.online = false;

    const local = await engine.load();
    expect(local).not.toBeNull();
    const exercises = engine.plan(local!, { kind: "topic", topicId: "t1" });
    expect(exercises.map((e) => e.vocabularyItemId).sort()).toEqual(["w1", "w3"]);

    const session = engine.startSession();
    const first = exercises[0]!;
    const outcome = await engine.answer(session, first, { answer: first.correctAnswer });
    expect(outcome.correct).toBe(true);

    expect(await engine.pendingCount()).toBe(1);
    const after = await store.getSnapshot();
    const state = after?.states.find((s) => s.vocabularyItemId === first.vocabularyItemId);
    expect(state?.introducedAt).toBe(NOW);
    expect(state?.lastResult).toBe("recalled");

    const sections = engine.sections(after!);
    expect(sections.all).toMatchObject({ total: 3, new: 2, learned: 1 });
  });

  it("keeps answers queued while offline and syncs them later", async () => {
    const { engine, api } = setup();
    await engine.refresh();
    const exercise = engine.plan((await engine.load())!, { kind: "all" })[0]!;
    const session = engine.startSession();

    api.online = false;
    await engine.answer(session, exercise, { answer: "nope" });
    const summary = await engine.finish(session);
    expect(summary).toMatchObject({ totalAttempts: 1, wrong: 1 });
    expect((await engine.sync()).ok).toBe(false);
    expect(await engine.pendingCount()).toBe(1);

    api.online = true;
    const result = await engine.sync();
    expect(result).toEqual({ ok: true, synced: 1, rejected: 0 });
    expect(await engine.pendingCount()).toBe(0);
    expect(api.requests[0]?.sessions[0]).toMatchObject({ id: session.id, finishedAt: NOW });
    expect(api.requests[0]?.attempts[0]).not.toHaveProperty("result");
  });

  it("replays unsynced answers over a freshly downloaded snapshot", async () => {
    const { engine, api } = setup();
    await engine.refresh();
    const exercise = engine.plan((await engine.load())!, { kind: "all" })[0]!;
    api.online = false;
    await engine.answer(engine.startSession(), exercise, { answer: exercise.correctAnswer });

    api.online = true;
    api.failStatus = 503;
    const refreshed = await engine.refresh();
    const state = refreshed.states.find((s) => s.vocabularyItemId === exercise.vocabularyItemId);
    expect(state?.lastResult).toBe("recalled");
  });

  it("summarizes a session even after its answers were already synced", async () => {
    const { engine, api } = setup();
    await engine.refresh();
    const [first, second] = engine.plan((await engine.load())!, { kind: "all" });
    const session = engine.startSession();
    await engine.answer(session, first!, { answer: first!.correctAnswer });
    await engine.sync();
    await engine.answer(session, second!, { answer: "nope" });
    await engine.sync();

    const summary = await engine.finish(session);
    expect(summary).toMatchObject({ wordsPracticed: 2, totalAttempts: 2, recalled: 1, wrong: 1 });
    await engine.sync();
    expect(api.requests.at(-1)?.sessions).toEqual([
      { id: session.id, startedAt: NOW, finishedAt: NOW },
    ]);
  });

  it("adopts server states after sync", async () => {
    const { engine, api, store } = setup();
    await engine.refresh();
    const exercise = engine.plan((await engine.load())!, { kind: "all" })[0]!;
    await engine.answer(engine.startSession(), exercise, { answer: exercise.correctAnswer });

    const serverState: SnapshotState = {
      vocabularyItemId: exercise.vocabularyItemId,
      dueAt: NOW + 5,
      introducedAt: NOW,
      successfulRecalls: 7,
      consecutiveFailures: 0,
      reviewStage: 2,
      difficulty: 0.3,
      lastResult: "recalled",
      lastReviewedAt: NOW,
    };
    api.serverStates = [serverState];
    await engine.sync();
    const snap = await store.getSnapshot();
    expect(snap?.states.find((s) => s.vocabularyItemId === exercise.vocabularyItemId)).toEqual(
      serverState,
    );
  });

  it("drops a batch the server rejects as invalid instead of blocking forever", async () => {
    const { engine, api } = setup();
    await engine.refresh();
    const exercise = engine.plan((await engine.load())!, { kind: "all" })[0]!;
    await engine.answer(engine.startSession(), exercise, { skipped: true });

    api.failStatus = 400;
    expect(await engine.sync()).toEqual({ ok: true, synced: 0, rejected: 1 });
    expect(await engine.pendingCount()).toBe(0);
  });
});
