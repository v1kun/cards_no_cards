"use client";

import type { PracticeSnapshot } from "@/domain/review/snapshot";
import { apiFetch } from "./api";
import {
  OfflinePractice,
  type OfflineApi,
  type SyncRequest,
  type SyncResponse,
} from "./offline-practice";
import { IndexedDbOfflineStore } from "./offline-store";

const api: OfflineApi = {
  fetchSnapshot: () => apiFetch<PracticeSnapshot>("/api/v1/offline/snapshot"),
  sync: (body: SyncRequest) =>
    apiFetch<SyncResponse>("/api/v1/review/sync", { method: "POST", body: JSON.stringify(body) }),
};

let engine: OfflinePractice | null = null;

/** The browser's single practice engine (IndexedDB-backed). */
export function getPracticeEngine(): OfflinePractice {
  engine ??= new OfflinePractice(new IndexedDbOfflineStore(), api);
  return engine;
}

export type BankStatus = {
  totalWords: number;
  upToDate: number;
  missing: number;
  stale: number;
  pending: number;
};

export type BankRefreshResult = {
  processed: number;
  succeeded: number;
  failed: { id: string; lemma: string }[];
  remaining: number;
};

export function getBankStatus(): Promise<BankStatus> {
  return apiFetch<BankStatus>("/api/v1/exercise-bank/status");
}

export function refreshBank(exclude: string[]): Promise<BankRefreshResult> {
  return apiFetch<BankRefreshResult>("/api/v1/exercise-bank/refresh", {
    method: "POST",
    body: JSON.stringify({ exclude }),
  });
}

export function regenerateWordExercises(id: string): Promise<{ count: number }> {
  return apiFetch<{ count: number }>(`/api/v1/vocabulary/${id}/exercises/regenerate`, {
    method: "POST",
  });
}
