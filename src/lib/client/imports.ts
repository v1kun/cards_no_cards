"use client";

import { apiFetch } from "./api";
import type { PartOfSpeech } from "./vocabulary";

export type ImportDecision = "pending" | "create" | "merge" | "skip";
export type ImportStatus = "pending" | "processing" | "needs_review" | "confirmed" | "failed";

export type ImportFormDto = { form: string; formType?: string; grammarNote?: string };

export type ImportItemDto = {
  id: string;
  decision: ImportDecision;
  proposedLemma: string | null;
  proposedTranslation: string | null;
  proposedPartOfSpeech: PartOfSpeech | null;
  proposedTopics: string[];
  proposedForms: ImportFormDto[];
  proposedExample: string | null;
  proposedExampleTranslation: string | null;
  confidence: number | null;
  matchVocabularyItemId: string | null;
  createdVocabularyItemId: string | null;
};

export type ImportBatchDto = {
  id: string;
  status: ImportStatus;
  rawText: string;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  items: ImportItemDto[];
};

export type ConfirmResultDto = {
  batchId: string;
  status: ImportStatus;
  createdVocabularyItemIds: string[];
  mergedVocabularyItemIds: string[];
};

export type ImportItemUpdate = {
  id: string;
  decision?: ImportDecision;
  proposedLemma?: string | null;
  proposedTranslation?: string | null;
  proposedPartOfSpeech?: PartOfSpeech | null;
  proposedTopics?: string[];
  proposedForms?: ImportFormDto[];
  proposedExample?: string | null;
  proposedExampleTranslation?: string | null;
  matchVocabularyItemId?: string | null;
};

export function createImport(input: {
  rawText: string;
  sourceType?: string;
}): Promise<ImportBatchDto> {
  return apiFetch<ImportBatchDto>("/api/v1/imports", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getImport(id: string): Promise<ImportBatchDto> {
  return apiFetch<ImportBatchDto>(`/api/v1/imports/${id}`);
}

export function updateImportItems(id: string, items: ImportItemUpdate[]): Promise<ImportBatchDto> {
  return apiFetch<ImportBatchDto>(`/api/v1/imports/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ items }),
  });
}

export function reprocessImport(id: string): Promise<ImportBatchDto> {
  return apiFetch<ImportBatchDto>(`/api/v1/imports/${id}/reprocess`, { method: "POST" });
}

export function confirmImport(id: string): Promise<ConfirmResultDto> {
  return apiFetch<ConfirmResultDto>(`/api/v1/imports/${id}/confirm`, { method: "POST" });
}
