import type { SectionFilter } from "@/domain/review/session-plan";

export type LabelLanguage = "en" | "ru";

const POS_LABELS: Record<string, { en: string; ru: string; emoji: string }> = {
  noun: { en: "Nouns", ru: "Существительные", emoji: "📦" },
  verb: { en: "Verbs", ru: "Глаголы", emoji: "🏃" },
  adjective: { en: "Adjectives", ru: "Прилагательные", emoji: "🎨" },
  adverb: { en: "Adverbs", ru: "Наречия", emoji: "⏱️" },
  preposition: { en: "Prepositions", ru: "Предлоги", emoji: "🧭" },
  pronoun: { en: "Pronouns", ru: "Местоимения", emoji: "👤" },
  conjunction: { en: "Conjunctions", ru: "Союзы", emoji: "🔗" },
  expression: { en: "Expressions", ru: "Выражения", emoji: "💬" },
  other: { en: "Other", ru: "Другое", emoji: "✳️" },
};

export function labelLanguage(value: string | null | undefined): LabelLanguage {
  return value === "ru" ? "ru" : "en";
}

export function partOfSpeechLabel(pos: string, lang: LabelLanguage): string {
  return POS_LABELS[pos]?.[lang] ?? pos;
}

export function partOfSpeechEmoji(pos: string): string {
  return POS_LABELS[pos]?.emoji ?? "✳️";
}

export function uncategorizedLabel(lang: LabelLanguage): string {
  return lang === "ru" ? "Без категории" : "Uncategorized";
}

export function allWordsLabel(lang: LabelLanguage): string {
  return lang === "ru" ? "Все слова" : "All words";
}

/** Keyword → emoji, matched against English and Russian topic names. */
const TOPIC_EMOJI: [RegExp, string][] = [
  // Order matters: "спорт" is inside "транспорт" and "день" inside "деньги".
  [/transport|travel|car|trip|транспорт|путеш|поездк/i, "🚌"],
  [/shop|store|money|магаз|покуп|деньг/i, "🛍️"],
  [/food|kitchen|cook|meal|eat|drink|еда|кухн|напит|блюд/i, "🍽️"],
  [/family|famil|семь|родств/i, "👨‍👩‍👧"],
  [/leisure|hobb|sport|free time|досуг|хобби|спорт|отдых/i, "⚽"],
  [/appearance|look|body|внешн|тело|тела/i, "🧍"],
  [/number|count|числ|цифр/i, "🔢"],
  [/time|day|week|month|calendar|врем|день|недел|месяц/i, "🕒"],
  [/house|home|дом|жиль/i, "🏠"],
  [/city|town|place|город|мест/i, "🏙️"],
  [/cloth|wear|одежд/i, "👕"],
  [/weather|season|погод|сезон/i, "🌤️"],
  [/work|job|office|school|study|работ|профес|учеб|школ/i, "💼"],
  [/color|colour|цвет/i, "🌈"],
  [/animal|pet|животн/i, "🐾"],
  [/health|doctor|здоров|врач/i, "🩺"],
  [/emotion|feel|чувств|эмоц/i, "💛"],
  [/greet|basic|приветств|основ/i, "👋"],
  [/action|routine|verb|действ|глагол/i, "🏃"],
  [/function word|grammar|служеб|граммат/i, "🧩"],
];

export function topicEmoji(name: string, isUncategorized = false): string {
  if (isUncategorized) return "🗂️";
  return TOPIC_EMOJI.find(([pattern]) => pattern.test(name))?.[1] ?? "🏷️";
}

/** Serializes a section into practice-session query params. */
export function sectionQuery(filter: SectionFilter): string {
  switch (filter.kind) {
    case "all":
      return "";
    case "topic":
      return `?topic=${encodeURIComponent(filter.topicId ?? "none")}`;
    case "pos":
      return `?pos=${encodeURIComponent(filter.partOfSpeech)}`;
  }
}

export function parseSection(params: { get(name: string): string | null }): SectionFilter {
  const topic = params.get("topic");
  if (topic) return { kind: "topic", topicId: topic === "none" ? null : topic };
  const pos = params.get("pos");
  if (pos) return { kind: "pos", partOfSpeech: pos };
  return { kind: "all" };
}
