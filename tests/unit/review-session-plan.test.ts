import { describe, expect, it } from "vitest";

import type { BankItem } from "@/domain/review/bank";
import { initialSchedulingState, type SchedulingState } from "@/domain/review/schedule";
import {
  EXTRA_SESSION_SIZE,
  pickDistractors,
  planExtraSession,
  planSession,
  summarizeSections,
  type PlanWord,
} from "@/domain/review/session-plan";

const now = new Date("2026-02-01T00:00:00Z");

function word(id: string, overrides: Partial<PlanWord> = {}): PlanWord {
  return {
    id,
    lemma: `lemma-${id}`,
    translation: `translation-${id}`,
    partOfSpeech: "noun",
    exampleSentence: null,
    forms: [],
    createdAt: Number(id.replace(/\D/g, "")) || 0,
    topicIds: [],
    ...overrides,
  };
}

function introduced(overrides: Partial<SchedulingState> = {}): SchedulingState {
  return {
    ...initialSchedulingState(),
    introducedAt: new Date("2026-01-01T00:00:00Z"),
    dueAt: new Date("2026-01-10T00:00:00Z"),
    reviewStage: 1,
    successfulRecalls: 1,
    lastReviewedAt: new Date("2026-01-09T00:00:00Z"),
    ...overrides,
  };
}

describe("planSession", () => {
  it("puts due words first, then caps new words, oldest first", () => {
    const words = Array.from({ length: 10 }, (_, i) => word(`w${i + 1}`));
    const states = new Map([["w9", introduced()]]);
    const plan = planSession({ words, states, bank: [], now });
    expect(plan.map((e) => e.vocabularyItemId)).toEqual(["w9", "w1", "w2", "w3", "w4", "w5"]);
    expect(plan[0]!.isNew).toBe(false);
    expect(plan[1]!.isNew).toBe(true);
  });

  it("skips words that are introduced but not yet due", () => {
    const words = [word("w1"), word("w2")];
    const states = new Map([["w1", introduced({ dueAt: new Date("2026-03-01T00:00:00Z") })]]);
    expect(planSession({ words, states, bank: [], now }).map((e) => e.vocabularyItemId)).toEqual([
      "w2",
    ]);
  });

  it("restricts selection to the chosen topic, part of speech, or uncategorized", () => {
    const words = [
      word("w1", { topicIds: ["food"] }),
      word("w2", { topicIds: ["home"], partOfSpeech: "verb" }),
      word("w3"),
    ];
    const states = new Map<string, SchedulingState>();
    const ids = (filter: Parameters<typeof planSession>[0]["filter"]) =>
      planSession({ words, states, bank: [], now, filter }).map((e) => e.vocabularyItemId);
    expect(ids({ kind: "topic", topicId: "food" })).toEqual(["w1"]);
    expect(ids({ kind: "pos", partOfSpeech: "verb" })).toEqual(["w2"]);
    expect(ids({ kind: "topic", topicId: null })).toEqual(["w3"]);
    expect(ids({ kind: "all" })).toEqual(["w1", "w2", "w3"]);
  });

  it("uses a bank question of the selected type when available", () => {
    const words = [word("w1"), word("w2"), word("w3")];
    const bank: BankItem[] = [
      {
        id: "b1",
        vocabularyItemId: "w1",
        exerciseType: "multiple_choice",
        sourceHash: "h",
        payload: {
          instruction: "Pick.",
          promptText: "lemma-w1",
          options: ["translation-w1", "x", "y"],
          correctAnswer: "translation-w1",
          acceptedAnswers: ["translation-w1"],
        },
      },
    ];
    const plan = planSession({ words, states: new Map(), bank, now });
    expect(plan[0]!.bankItemId).toBe("b1");
    expect(plan[1]!.bankItemId).toBeNull();
    expect(plan[1]!.exerciseType).toBe("multiple_choice");
    expect(plan[1]!.options).toContain("translation-w2");
  });

  it("uses reverse multiple choice with Spanish options after one recall", () => {
    const words = [word("w1"), word("w2"), word("w3")];
    const states = new Map([["w1", introduced()]]);
    const [first] = planSession({ words, states, bank: [], now });
    expect(first!.exerciseType).toBe("multiple_choice_reverse");
    expect(first!.promptText).toBe("translation-w1");
    expect(first!.options).toContain("lemma-w1");
    expect(first!.acceptedAnswers).toEqual(["lemma-w1"]);
  });

  it("falls back to recall when no distractors exist", () => {
    const [only] = planSession({ words: [word("w1")], states: new Map(), bank: [], now });
    expect(only!.exerciseType).toBe("recall");
  });
});

describe("planExtraSession", () => {
  const notDue = (overrides: Partial<SchedulingState> = {}) =>
    introduced({ dueAt: new Date("2026-03-01T00:00:00Z"), ...overrides });

  it("drills only introduced words in the section, weakest first, marked extra", () => {
    const words = [
      word("w1", { topicIds: ["food"] }),
      word("w2", { topicIds: ["food"] }),
      word("w3", { topicIds: ["food"] }),
      word("w4", { topicIds: ["home"] }),
    ];
    const states = new Map([
      ["w1", notDue({ reviewStage: 3 })],
      ["w2", notDue({ reviewStage: 2, lastResult: "wrong" })],
      ["w4", notDue()],
    ]);
    const plan = planExtraSession({
      words,
      states,
      bank: [],
      now,
      filter: { kind: "topic", topicId: "food" },
      random: seeded(3),
    });
    expect(plan.map((e) => e.vocabularyItemId)).toEqual(["w2", "w1"]);
    expect(plan.every((e) => e.extra === true && !e.isNew)).toBe(true);
  });

  it("caps the size, varies the pick, and prefers words not drilled recently", () => {
    const words = Array.from({ length: 30 }, (_, i) => word(`w${i + 1}`));
    const states = new Map(words.map((w) => [w.id, notDue()]));
    const ids = (seed: number, exclude?: Set<string>) =>
      planExtraSession({ words, states, bank: [], now, random: seeded(seed), exclude }).map(
        (e) => e.vocabularyItemId,
      );
    const first = ids(1);
    expect(first).toHaveLength(EXTRA_SESSION_SIZE);
    expect(ids(2)).not.toEqual(first);
    const next = ids(1, new Set(first));
    expect(next.some((id) => first.includes(id))).toBe(false);
  });

  it("returns nothing when no word in the section was introduced", () => {
    expect(planExtraSession({ words: [word("w1")], states: new Map(), bank: [], now })).toEqual([]);
  });
});

describe("summarizeSections", () => {
  it("counts new, due, and learned words per section", () => {
    const words = [
      word("w1", { topicIds: ["food"] }),
      word("w2", { topicIds: ["food"], partOfSpeech: "verb" }),
      word("w3"),
    ];
    const states = new Map([
      ["w1", introduced()],
      ["w2", introduced({ dueAt: new Date("2026-03-01T00:00:00Z") })],
    ]);
    const summary = summarizeSections({
      words,
      states,
      topics: [
        { id: "food", name: "Food" },
        { id: "empty", name: "Empty" },
      ],
      now,
    });
    expect(summary.all).toEqual({ total: 3, learned: 1, due: 1, new: 1 });
    expect(summary.topics).toEqual([
      { topicId: "food", name: "Food", counts: { total: 2, learned: 1, due: 1, new: 0 } },
      { topicId: null, name: "Uncategorized", counts: { total: 1, learned: 0, due: 0, new: 1 } },
    ]);
    expect(summary.partsOfSpeech[0]).toEqual({
      partOfSpeech: "noun",
      counts: { total: 2, learned: 0, due: 1, new: 1 },
    });
  });
});

describe("pickDistractors", () => {
  it("prefers the same topic over the same part of speech", () => {
    const target = word("w1", { topicIds: ["animals"] });
    const pool = [
      target,
      word("w2", { topicIds: ["food"] }),
      word("w3", { topicIds: ["animals"], partOfSpeech: "adjective" }),
      word("w4", { topicIds: ["animals"] }),
      word("w5", { topicIds: ["city"] }),
      word("w6", { topicIds: ["food"], partOfSpeech: "verb" }),
    ];
    for (const seed of [1, 2, 3, 4]) {
      const picked = pickDistractors(target, pool, false, seeded(seed));
      expect(picked.slice(0, 2)).toEqual(["translation-w4", "translation-w3"]);
      expect(picked).toHaveLength(3);
      expect(picked).not.toContain("translation-w6");
    }
  });

  it("falls back to other words when the topic is too small", () => {
    const target = word("w1", { topicIds: ["animals"] });
    const picked = pickDistractors(target, [target, word("w2"), word("w3")], true, seeded(1));
    expect(picked.sort()).toEqual(["lemma-w2", "lemma-w3"]);
  });

  it("draws different wrong answers from the whole topic", () => {
    const pool = Array.from({ length: 12 }, (_, i) => word(`a${i}`, { topicIds: ["animals"] }));
    const sets = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) =>
        pickDistractors(pool[0]!, pool, false, seeded(seed)).sort().join("|"),
      ),
    );
    expect(sets.size).toBeGreaterThan(1);
  });
});

describe("multiple-choice options", () => {
  it("replaces stored bank options with same-topic words in random order", () => {
    const words = Array.from({ length: 10 }, (_, i) => word(`w${i}`, { topicIds: ["animals"] }));
    const bank = [
      {
        id: "b1",
        vocabularyItemId: "w0",
        exerciseType: "multiple_choice" as const,
        sourceHash: "h",
        payload: {
          instruction: "Pick.",
          promptText: "lemma-w0",
          options: ["translation-w0", "stale-1", "stale-2", "stale-3"],
          correctAnswer: "translation-w0",
          acceptedAnswers: ["translation-w0"],
        },
      },
    ];
    const orders = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const [first] = planSession({
        words,
        states: new Map(),
        bank,
        now,
        limits: { new: 1 },
        random: seeded(seed),
      });
      expect(first!.bankItemId).toBe("b1");
      expect(first!.options).toHaveLength(4);
      expect(first!.options).toContain("translation-w0");
      expect(first!.options!.some((option) => option.startsWith("stale"))).toBe(false);
      orders.add(first!.options!.join("|"));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});

/** Deterministic PRNG (mulberry32) for repeatable "random" tests. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
