"use client";

import type { PracticeSnapshot } from "@/domain/review/snapshot";
import { ApiClientError, apiFetch } from "./api";
import { connection } from "./connection";
import {
  OfflinePractice,
  type OfflineApi,
  type SyncRequest,
  type SyncResponse,
} from "./offline-practice";
import { deleteOfflineDb, IndexedDbOfflineStore, offlineDbName } from "./offline-store";
import { currentUserId, rememberUser, signOutRequest } from "./user";

/** Records whether the server answered, for the connection indicator. */
async function tracked<T>(request: Promise<T>): Promise<T> {
  try {
    const result = await request;
    connection.setServerReachable(true);
    return result;
  } catch (error) {
    if (error instanceof ApiClientError) connection.setServerReachable(error.status !== 0);
    throw error;
  }
}

const api: OfflineApi = {
  fetchSnapshot: () => tracked(apiFetch<PracticeSnapshot>("/api/v1/offline/snapshot")),
  sync: async (body: SyncRequest) => {
    connection.setSyncing(true);
    try {
      return await tracked(
        apiFetch<SyncResponse>("/api/v1/review/sync", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    } finally {
      connection.setSyncing(false);
    }
  },
};

let current: { userId: string; store: IndexedDbOfflineStore; engine: OfflinePractice } | null =
  null;

/** The practice engine of the signed-in user (IndexedDB-backed, one per user). */
export function getPracticeEngine(): OfflinePractice {
  const userId = currentUserId();
  if (current?.userId !== userId) {
    void current?.store.close();
    const store = new IndexedDbOfflineStore(offlineDbName(userId));
    current = { userId, store, engine: new OfflinePractice(store, api) };
  }
  return current.engine;
}

/**
 * Signs out: clears the session cookie and removes this user's offline data
 * from the device. Needs the server (throws offline, keeping everything).
 * Callers warn first when answers are still unsynced.
 */
export async function signOut(): Promise<void> {
  const userId = currentUserId();
  await signOutRequest();
  await current?.store.close();
  current = null;
  await deleteOfflineDb(userId);
  rememberUser(null);
}

/**
 * Refreshes the connection indicator: uploads pending answers if there are
 * any (which also probes the server), otherwise pings the health check.
 */
export async function checkConnection(): Promise<void> {
  const practice = getPracticeEngine();
  const pending = await practice.pendingCount();
  connection.setPending(pending);
  if (!navigator.onLine) return;
  if (pending > 0) {
    await practice.sync().catch(() => undefined);
    connection.setPending(await practice.pendingCount());
  } else {
    await tracked(apiFetch("/api/health", { cache: "no-store" })).catch(() => undefined);
  }
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
