import type { ImportBatch, ImportItem } from "@/server/repositories/imports";

function parseArray<T>(value: string | null): T[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function serializeImportItem(item: ImportItem) {
  return {
    id: item.id,
    decision: item.decision,
    proposedLemma: item.proposedLemma,
    proposedTranslation: item.proposedTranslation,
    proposedPartOfSpeech: item.proposedPartOfSpeech,
    proposedTopics: parseArray<string>(item.proposedTopics),
    proposedForms: parseArray<{ form: string; formType?: string; grammarNote?: string }>(
      item.proposedForms,
    ),
    proposedExample: item.proposedExample,
    proposedExampleTranslation: item.proposedExampleTranslation,
    confidence: item.confidence,
    matchVocabularyItemId: item.matchVocabularyItemId,
    createdVocabularyItemId: item.createdVocabularyItemId,
  };
}

export function serializeImportBatch(batch: ImportBatch, items: ImportItem[]) {
  return {
    id: batch.id,
    status: batch.status,
    rawText: batch.rawText,
    errorCode: batch.errorCode,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    items: items.map(serializeImportItem),
  };
}
