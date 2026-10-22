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
  /** Source of randomness for distractors and option order (tests pass a seeded one). */
  random?: () => number;
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
  const random = input.random ?? Math.random;
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

  const plan = exerciseBuilder(input, random);
  return [...due.map((word) => plan(word, false)), ...fresh.map((word) => plan(word, true))];
}

/** Upper bound on words in one extra-practice session. */
export const EXTRA_SESSION_SIZE = 10;

export type ExtraPlanInput = PlanInput & {
  size?: number;
  /** Words already drilled recently; used only when nothing else is left. */
  exclude?: ReadonlySet<string>;
};

/**
 * Plans extra practice for a section whose schedule is empty: already
 * introduced words, weakest first (last answer wrong, then lower ladder
 * stage), random within each group. Exercises are marked `extra` so their
 * answers only touch the schedule when wrong.
 */
export function planExtraSession(input: ExtraPlanInput): PracticeExercise[] {
  const random = input.random ?? Math.random;
  const filter = input.filter ?? { kind: "all" };
  const size = input.size ?? EXTRA_SESSION_SIZE;
  const exclude = input.exclude ?? new Set<string>();
  const weakness = (word: PlanWord) => {
    const state = input.states.get(word.id)!;
    return (state.lastResult === "wrong" ? 0 : 100) + state.reviewStage;
  };
  const introduced = shuffle(
    input.words.filter(
      (word) => matchesFilter(word, filter) && isIntroduced(input.states.get(word.id)),
    ),
    random,
  ).sort((a, b) => weakness(a) - weakness(b));
  const ordered = [
    ...introduced.filter((word) => !exclude.has(word.id)),
    ...introduced.filter((word) => exclude.has(word.id)),
  ].slice(0, size);

  const plan = exerciseBuilder(input, random);
  return ordered.map((word) => ({ ...plan(word, false), extra: true }));
}

function exerciseBuilder(input: PlanInput, random: () => number) {
  const bankByWord = new Map<string, BankItem[]>();
  for (const item of input.bank) {
    const list = bankByWord.get(item.vocabularyItemId) ?? [];
    list.push(item);
    bankByWord.set(item.vocabularyItemId, list);
  }

  return (word: PlanWord, isNew: boolean): PracticeExercise => {
    const state = input.states.get(word.id);
    const items = bankByWord.get(word.id) ?? [];
    const type = selectExerciseType({
      isNew,
      successfulRecalls: state?.successfulRecalls ?? 0,
      exampleSentence: word.exampleSentence,
      lemma: word.lemma,
      clozeAvailable: items.some((item) => item.exerciseType === "cloze"),
      random,
    });
    const seed = `${word.id}:${state?.lastReviewedAt?.getTime() ?? 0}`;

    const variants = items.filter((item) => item.exerciseType === type);
    if (variants.length > 0) {
      const chosen = variants[hashString(seed) % variants.length]!;
      return withFreshOptions(bankItemToExercise(chosen, isNew), word, input.words, random);
    }
    return deterministicExercise(word, type, isNew, input.words, random);
  };
}

function deterministicExercise(
  word: PlanWord,
  type: ExerciseType,
  isNew: boolean,
  pool: PlanWord[],
  random: () => number,
): PracticeExercise {
  if (!isMultipleChoice(type)) {
    return buildExercise(word, type, isNew);
  }
  const reverse = type === "multiple_choice_reverse";
  const distractors = pickDistractors(word, pool, reverse, random);
  // Multiple choice needs at least one distractor to be meaningful.
  if (distractors.length === 0) {
    return buildExercise(word, "recall", isNew);
  }
  const exercise = buildExercise(word, type, isNew, distractors);
  return { ...exercise, options: shuffle(exercise.options ?? [], random) };
}

/**
 * Multiple-choice options are drawn afresh every session from the learner's
 * whole vocabulary (same topic first) and shown in random order, so stored
 * bank questions do not repeat the same set of wrong answers.
 */
function withFreshOptions(
  exercise: PracticeExercise,
  word: PlanWord,
  pool: PlanWord[],
  random: () => number,
): PracticeExercise {
  if (!isMultipleChoice(exercise.exerciseType) || !exercise.options) return exercise;
  const reverse = exercise.exerciseType === "multiple_choice_reverse";
  const correct = exercise.correctAnswer;
  const distractors = pickDistractors(word, pool, reverse, random).filter(
    (option) => normalizeAnswer(option) !== normalizeAnswer(correct),
  );
  const wrong =
    distractors.length > 0
      ? distractors
      : exercise.options.filter((option) => normalizeAnswer(option) !== normalizeAnswer(correct));
  return { ...exercise, options: shuffle([correct, ...wrong], random) };
}

/**
 * Picks random distractors from the learner's other words, preferring the
 * same topic and part of speech, then the same topic, then the same part of
 * speech, then anything — chosen at random within each group.
 */
export function pickDistractors(
  word: PlanWord,
  pool: PlanWord[],
  reverse: boolean,
  random: () => number = Math.random,
  max = MAX_DISTRACTORS,
): string[] {
  const value = (candidate: PlanWord) => (reverse ? candidate.lemma : candidate.translation);
  const correctKey = normalizeAnswer(value(word));
  const topics = new Set(word.topicIds);
  const rank = (candidate: PlanWord) =>
    (candidate.topicIds.some((id) => topics.has(id)) ? 0 : 2) +
    (candidate.partOfSpeech === word.partOfSpeech ? 0 : 1);
  // Stable sort keeps the random order within each rank.
  const ordered = shuffle(
    pool.filter((candidate) => candidate.id !== word.id),
    random,
  ).sort((a, b) => rank(a) - rank(b));
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

/** Fisher–Yates shuffle into a new array. */
function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
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
