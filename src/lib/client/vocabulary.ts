"use client";

import { apiFetch } from "./api";

export const PARTS_OF_SPEECH = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "preposition",
  "pronoun",
  "conjunction",
  "expression",
  "other",
] as const;

export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];
export type VocabularyStatus = "active" | "archived";

export type TopicDto = { id: string; name: string };

export type ReviewSummaryDto = {
  dueAt: string | null;
  reviewStage: number;
  successfulRecalls: number;
  consecutiveFailures: number;
  lastResult: string | null;
  lastReviewedAt: string | null;
} | null;

export type FormDto = {
  id: string;
  form: string;
  formType: string | null;
  grammarNote: string | null;
};

export type SourceDto = {
  id: string;
  sourceType: string;
  sourceText: string | null;
  lessonId: string | null;
  createdAt: string;
};

export type VocabularyListItemDto = {
  id: string;
  lemma: string;
  translation: string;
  partOfSpeech: PartOfSpeech;
  definition: string | null;
  gender: string | null;
  exampleSentence: string | null;
  exampleTranslation: string | null;
  status: VocabularyStatus;
  createdAt: string;
  updatedAt: string;
  topics: TopicDto[];
  reviewSummary: ReviewSummaryDto;
};

export type VocabularyDetailDto = VocabularyListItemDto & {
  forms: FormDto[];
  sources: SourceDto[];
};

export type VocabularyFilters = {
  search?: string;
  partOfSpeech?: PartOfSpeech | "";
  status?: VocabularyStatus | "";
  topicId?: string;
  dueOnly?: boolean;
  limit?: number;
  offset?: number;
};

export type VocabularyPageDto = {
  items: VocabularyListItemDto[];
  pagination: { total: number; limit: number; offset: number };
};

export function listVocabulary(filters: VocabularyFilters): Promise<VocabularyPageDto> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.partOfSpeech) params.set("partOfSpeech", filters.partOfSpeech);
  if (filters.status) params.set("status", filters.status);
  if (filters.topicId) params.set("topicId", filters.topicId);
  if (filters.dueOnly) params.set("dueOnly", "true");
  if (filters.limit != null) params.set("limit", String(filters.limit));
  if (filters.offset != null) params.set("offset", String(filters.offset));
  const query = params.toString();
  return apiFetch<VocabularyPageDto>(`/api/v1/vocabulary${query ? `?${query}` : ""}`);
}

export type CreateVocabularyBody = {
  lemma: string;
  translation: string;
  partOfSpeech: PartOfSpeech;
  definition?: string;
  exampleSentence?: string;
  exampleTranslation?: string;
  topics: string[];
};

export function createVocabulary(
  body: CreateVocabularyBody,
): Promise<{ item: VocabularyDetailDto }> {
  return apiFetch("/api/v1/vocabulary", { method: "POST", body: JSON.stringify(body) });
}

export function getVocabulary(id: string): Promise<{ item: VocabularyDetailDto }> {
  return apiFetch(`/api/v1/vocabulary/${id}`);
}

export type UpdateVocabularyBody = Partial<{
  lemma: string;
  translation: string;
  partOfSpeech: PartOfSpeech;
  definition: string | null;
  exampleSentence: string | null;
  exampleTranslation: string | null;
  topics: string[];
}>;

export function updateVocabulary(
  id: string,
  body: UpdateVocabularyBody,
): Promise<{ item: VocabularyDetailDto }> {
  return apiFetch(`/api/v1/vocabulary/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function archiveVocabulary(id: string): Promise<{ item: VocabularyDetailDto }> {
  return apiFetch(`/api/v1/vocabulary/${id}`, { method: "DELETE" });
}

export function restoreVocabulary(id: string): Promise<{ item: VocabularyDetailDto }> {
  return apiFetch(`/api/v1/vocabulary/${id}/restore`, { method: "POST" });
}

export function deleteVocabulary(id: string): Promise<{ deleted: boolean; id: string }> {
  return apiFetch(`/api/v1/vocabulary/${id}?hard=true`, { method: "DELETE" });
}

export function listTopics(): Promise<{ topics: TopicDto[] }> {
  return apiFetch("/api/v1/topics");
}
