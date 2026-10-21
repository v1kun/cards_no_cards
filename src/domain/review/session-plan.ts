/**
 * Session planning and section summaries. Pure functions shared by the
 * offline client engine (and tests); no database, network, or UI concerns.
 */
import { bankItemToExercise, type BankItem } from "./bank";
import {
  buildExercise,
  isMultipleChoice,
  normalizeAnswer,
  selectExerciseType,
  type ExerciseType,
  type ExerciseWord,
  type PracticeExercise,
} from "./exercises";
import type { SchedulingState } from "./schedule";

/** Target number of new words introduced per session, availability allowing. */
export const NEW_WORD_TARGET = 5;
/** Upper bound on due reviews pulled into a single session. */
export const DUE_REVIEW_LIMIT = 20;
const MAX_DISTRACTORS = 3;

/** An active word as known to the planner. */
export type PlanWord = ExerciseWord & {
  /** Creation time in ms; new words are introduced oldest first. */
  createdAt: number;
  topicIds: string[];
};

/** A practice section: everything, one topic (null = uncategorized), or one part of speech. */
export type SectionFilter =
  | { kind: "all" }
  | { kind: "topic"; topicId: string | null }
  | { kind: "pos"; partOfSpeech: string };

export type PlanInput = {
  words: PlanWord[];
  states: ReadonlyMap<string, SchedulingState>;
  bank: BankItem[];
  now: Date;
  filter?: SectionFilter;
  limits?: { due?: number; new?: number };
};

export function matchesFilter(word: PlanWord, filter: SectionFilter): boolean {
  switch (filter.kind) {
    case "all":
      return true;
    case "topic":
      return filter.topicId === null
        ? word.topicIds.length === 0
        : word.topicIds.includes(filter.topicId);
    case "pos":
      return word.partOfSpeech === filter.partOfSpeech;
  }
}

function isIntroduced(state: SchedulingState | undefined): state is SchedulingState {
  return Boolean(state?.introducedAt);
}

function isDue(state: SchedulingState | undefined, now: Date): boolean {
  return isIntroduced(state) && state.dueAt !== null && state.dueAt.getTime() <= now.getTime();
}

/**
 * Plans a session for the chosen section: due reviews first (most overdue
 * first), then up to the new-word target, oldest first. Each word gets a
 * bank question of the selected type when one exists, rotating variants;
 * otherwise a deterministic exercise is built from the word itself.
 */
export function planSession(input: PlanInput): PracticeExercise[] {
  const filter = input.filter ?? { kind: "all" };
  const dueLimit = input.limits?.due ?? DUE_REVIEW_LIMIT;
  const newLimit = input.limits?.new ?? NEW_WORD_TARGET;
  const inSection = input.words.filter((word) => matchesFilter(word, filter));

  const due = inSection
    .filter((word) => isDue(input.states.get(word.id), input.now))
    .sort(
      (a, b) => input.states.get(a.id)!.dueAt!.getTime() - input.states.get(b.id)!.dueAt!.getTime(),
    )
    .slice(0, dueLimit);
  const fresh = inSection
    .filter((word) => !isIntroduced(input.states.get(word.id)))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .slice(0, newLimit);

  const bankByWord = new Map<string, BankItem[]>();
  for (const item of input.bank) {
    const list = bankByWord.get(item.vocabularyItemId) ?? [];
    list.push(item);
    bankByWord.set(item.vocabularyItemId, list);
  }

  const plan = (word: PlanWord, isNew: boolean): PracticeExercise => {
    const state = input.states.get(word.id);
    const items = bankByWord.get(word.id) ?? [];
    const type = selectExerciseType({
      isNew,
      successfulRecalls: state?.successfulRecalls ?? 0,
      exampleSentence: word.exampleSentence,
      lemma: word.lemma,
      clozeAvailable: items.some((item) => item.exerciseType === "cloze"),
    });
    const seed = `${word.id}:${state?.lastReviewedAt?.getTime() ?? 0}`;

    const variants = items.filter((item) => item.exerciseType === type);
    if (variants.length > 0) {
      const chosen = variants[hashString(seed) % variants.length]!;
      return bankItemToExercise(chosen, isNew);
    }
    return deterministicExercise(word, type, isNew, input.words, seed);
  };

  return [...due.map((word) => plan(word, false)), ...fresh.map((word) => plan(word, true))];
}

function deterministicExercise(
  word: PlanWord,
  type: ExerciseType,
  isNew: boolean,
  pool: PlanWord[],
  seed: string,
): PracticeExercise {
  if (!isMultipleChoice(type)) {
    return buildExercise(word, type, isNew);
  }
  const reverse = type === "multiple_choice_reverse";
  const distractors = pickDistractors(word, pool, reverse, seed);
  // Multiple choice needs at least one distractor to be meaningful.
  if (distractors.length === 0) {
    return buildExercise(word, "recall", isNew);
  }
  return buildExercise(word, type, isNew, distractors);
}

/**
 * Picks distractors from the learner's other words, preferring words from
 * the same topic (then the same part of speech), with a seeded rotation so
 * options vary between sessions.
 */
export function pickDistractors(
  word: PlanWord,
  pool: PlanWord[],
  reverse: boolean,
  seed: string,
  max = MAX_DISTRACTORS,
): string[] {
  const value = (candidate: PlanWord) => (reverse ? candidate.lemma : candidate.translation);
  const correctKey = normalizeAnswer(value(word));
  const others = pool.filter((candidate) => candidate.id !== word.id);
  if (others.length === 0) return [];
  const offset = hashString(seed) % others.length;
  const rotated = [...others.slice(offset), ...others.slice(0, offset)];
  const topics = new Set(word.topicIds);
  const rank = (candidate: PlanWord) =>
    (candidate.topicIds.some((id) => topics.has(id)) ? 0 : 2) +
    (candidate.partOfSpeech === word.partOfSpeech ? 0 : 1);
  // Stable sort keeps the seeded rotation within each rank.
  const ordered = [...rotated].sort((a, b) => rank(a) - rank(b));
  const seen = new Set<string>([correctKey]);
  const picked: string[] = [];
  for (const candidate of ordered) {
    const text = value(candidate);
    const key = normalizeAnswer(text);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    picked.push(text);
    if (picked.length >= max) break;
  }
  return picked;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// --- Sections ---------------------------------------------------------------

export type SectionCounts = {
  total: number;
  /** Introduced and not yet due. */
  learned: number;
  due: number;
  new: number;
};

export type SectionSummary = {
  all: SectionCounts;
  topics: { topicId: string | null; name: string; counts: SectionCounts }[];
  partsOfSpeech: { partOfSpeech: string; counts: SectionCounts }[];
};

function emptyCounts(): SectionCounts {
  return { total: 0, learned: 0, due: 0, new: 0 };
}

function addTo(counts: SectionCounts, state: SchedulingState | undefined, now: Date) {
  counts.total += 1;
  if (!isIntroduced(state)) counts.new += 1;
  else if (isDue(state, now)) counts.due += 1;
  else counts.learned += 1;
}

/**
 * Per-section progress counters. Topics are listed in the given order
 * (empty ones omitted) followed by an "uncategorized" entry (topicId null)
 * when some words have no topic.
 */
export function summarizeSections(input: {
  words: PlanWord[];
  states: ReadonlyMap<string, SchedulingState>;
  topics: { id: string; name: string }[];
  now: Date;
  uncategorizedName?: string;
}): SectionSummary {
  const all = emptyCounts();
  const byTopic = new Map<string, SectionCounts>();
  const uncategorized = emptyCounts();
  const byPos = new Map<string, SectionCounts>();

  for (const word of input.words) {
    const state = input.states.get(word.id);
    addTo(all, state, input.now);
    if (word.topicIds.length === 0) addTo(uncategorized, state, input.now);
    for (const topicId of new Set(word.topicIds)) {
      const counts = byTopic.get(topicId) ?? emptyCounts();
      addTo(counts, state, input.now);
      byTopic.set(topicId, counts);
    }
    const posCounts = byPos.get(word.partOfSpeech) ?? emptyCounts();
    addTo(posCounts, state, input.now);
    byPos.set(word.partOfSpeech, posCounts);
  }

  const topics: SectionSummary["topics"] = input.topics
    .filter((topic) => byTopic.has(topic.id))
    .map((topic) => ({ topicId: topic.id, name: topic.name, counts: byTopic.get(topic.id)! }));
  if (uncategorized.total > 0) {
    topics.push({
      topicId: null,
      name: input.uncategorizedName ?? "Uncategorized",
      counts: uncategorized,
    });
  }
  const partsOfSpeech = [...byPos.entries()]
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
    .map(([partOfSpeech, counts]) => ({ partOfSpeech, counts }));

  return { all, topics, partsOfSpeech };
}
