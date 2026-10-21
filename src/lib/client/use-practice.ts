"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PracticeSnapshot } from "@/domain/review/snapshot";
import { ApiClientError } from "./api";
import { getPracticeEngine } from "./practice";

export type PracticeData = {
  snapshot: PracticeSnapshot | null;
  /** True until the local copy has been read. */
  loading: boolean;
  /** True while syncing / downloading a fresh copy in the background. */
  refreshing: boolean;
  pending: number;
  /** Last network problem, if any; practice still works from the local copy. */
  networkError: string | null;
  syncNow: () => Promise<void>;
  reload: () => Promise<void>;
};

function describe(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.status === 0 ? "You are offline — using the saved copy." : error.message;
  }
  return "Could not update the saved copy.";
}

/**
 * Shows the locally saved practice data immediately, then (when online)
 * uploads pending answers and downloads a fresh snapshot in the background.
 * Pending answers are retried whenever the browser comes back online.
 */
export function usePracticeData(
  options: { refreshOnMount?: boolean | "if-missing" } = {},
): PracticeData {
  const refreshOnMount = options.refreshOnMount ?? true;
  const [snapshot, setSnapshot] = useState<PracticeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState(0);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const busy = useRef(false);

  const updatePending = useCallback(async () => {
    setPending(await getPracticeEngine().pendingCount());
  }, []);

  const syncNow = useCallback(async () => {
    const engine = getPracticeEngine();
    const result = await engine.sync();
    if (result.ok) {
      setNetworkError(null);
      const saved = await engine.load();
      if (saved) setSnapshot(saved);
    }
    await updatePending();
  }, [updatePending]);

  const reload = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    const engine = getPracticeEngine();
    try {
      await engine.sync();
      setSnapshot(await engine.refresh());
      setNetworkError(null);
    } catch (error) {
      setNetworkError(describe(error));
    } finally {
      await updatePending();
      busy.current = false;
      setRefreshing(false);
    }
  }, [updatePending]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const engine = getPracticeEngine();
      const saved = await engine.load().catch(() => null);
      if (cancelled) return;
      setSnapshot(saved);
      setLoading(false);
      await updatePending();
      const wanted = refreshOnMount === "if-missing" ? !saved : refreshOnMount;
      if (wanted && navigator.onLine) await reload();
      else if (!navigator.onLine) setNetworkError(describe(new ApiClientError("NETWORK", "", 0)));
    })();
    const onOnline = () => void syncNow().catch(() => undefined);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [refreshOnMount, reload, syncNow, updatePending]);

  return { snapshot, loading, refreshing, pending, networkError, syncNow, reload };
}
