import type {
  ReviewSummary,
  VocabularyDetail,
  VocabularyForm,
  VocabularyItem,
  VocabularyListItem,
  VocabularyWithRelations,
  WordSource,
} from "@/server/repositories/vocabulary";
import type { Topic } from "@/server/repositories/topics";

/**
 * JSON serializers for vocabulary responses.
 *
 * Dates are emitted as ISO strings and timestamps/`null`s are made explicit
 * so clients get a stable, self-describing shape across every endpoint.
 */

function serializeTopic(topic: Topic) {
  return { id: topic.id, name: topic.name };
}

function serializeForm(form: VocabularyForm) {
  return {
    id: form.id,
    form: form.form,
    formType: form.formType,
    grammarNote: form.grammarNote,
  };
}

function serializeSource(source: WordSource) {
  return {
    id: source.id,
    sourceType: source.sourceType,
    sourceText: source.sourceText,
    lessonId: source.lessonId,
    createdAt: source.createdAt.toISOString(),
  };
}

function serializeReviewSummary(summary: ReviewSummary) {
  if (!summary) {
    return null;
  }
  return {
    dueAt: summary.dueAt?.toISOString() ?? null,
    introducedAt: summary.introducedAt?.toISOString() ?? null,
    reviewStage: summary.reviewStage,
    successfulRecalls: summary.successfulRecalls,
    consecutiveFailures: summary.consecutiveFailures,
    lastResult: summary.lastResult,
    lastReviewedAt: summary.lastReviewedAt?.toISOString() ?? null,
  };
}

function serializeItem(item: VocabularyItem) {
  return {
    id: item.id,
    lemma: item.lemma,
    translation: item.translation,
    partOfSpeech: item.partOfSpeech,
    definition: item.definition,
    gender: item.gender,
    exampleSentence: item.exampleSentence,
    exampleTranslation: item.exampleTranslation,
    languageCode: item.languageCode,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function serializeListItem(item: VocabularyListItem) {
  return {
    ...serializeItem(item),
    topics: item.topics.map(serializeTopic),
    reviewSummary: serializeReviewSummary(item.reviewSummary),
  };
}

export function serializeWithRelations(item: VocabularyWithRelations) {
  return {
    ...serializeItem(item),
    topics: item.topics.map(serializeTopic),
    forms: item.forms.map(serializeForm),
  };
}

export function serializeDetail(item: VocabularyDetail) {
  return {
    ...serializeItem(item),
    topics: item.topics.map(serializeTopic),
    forms: item.forms.map(serializeForm),
    sources: item.sources.map(serializeSource),
    reviewSummary: serializeReviewSummary(item.reviewSummary),
  };
}
