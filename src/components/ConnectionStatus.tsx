"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { connection, connectionKind, type ConnectionKind } from "@/lib/client/connection";
import { checkConnection, getPracticeEngine } from "@/lib/client/practice";

const CHECK_INTERVAL_MS = 15_000;
const PENDING_INTERVAL_MS = 2_000;

const TITLES: Record<ConnectionKind, string> = {
  offline: "No network. Practice works from the saved copy; answers sync when you are back online.",
  unreachable:
    "The server is not reachable (for example, away from the home network). Practice works offline; answers sync later.",
  syncing: "Uploading your answers…",
  pending: "Some answers are not uploaded yet. Tap to sync now.",
  synced: "Connected. All answers are saved on the server.",
};

function label(kind: ConnectionKind, pending: number): string {
  const queued = pending > 0 ? ` · ${pending} to sync` : "";
  switch (kind) {
    case "offline":
      return `Offline${queued}`;
    case "unreachable":
      return `No server${queued}`;
    case "syncing":
      return "Syncing…";
    case "pending":
      return `${pending} to sync`;
    case "synced":
      return "Online";
  }
}

/**
 * Practice connection indicator: offline, server unreachable, answers
 * waiting to sync, or everything saved. Tapping it retries the sync.
 */
export function ConnectionStatus() {
  const state = useSyncExternalStore(connection.subscribe, connection.get, connection.get);
  const [browserOnline, setBrowserOnline] = useState(true);

  useEffect(() => {
    const onNetworkChange = () => {
      setBrowserOnline(navigator.onLine);
      void checkConnection();
    };
    const refreshPending = () =>
      void getPracticeEngine()
        .pendingCount()
        .then(connection.setPending)
        .catch(() => undefined);

    onNetworkChange();
    window.addEventListener("online", onNetworkChange);
    window.addEventListener("offline", onNetworkChange);
    const check = window.setInterval(() => void checkConnection(), CHECK_INTERVAL_MS);
    const pending = window.setInterval(refreshPending, PENDING_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", onNetworkChange);
      window.removeEventListener("offline", onNetworkChange);
      window.clearInterval(check);
      window.clearInterval(pending);
    };
  }, []);

  const kind = connectionKind(browserOnline, state);
  return (
    <button
      type="button"
      className={`connection-status ${kind}`}
      title={TITLES[kind]}
      aria-label={`${label(kind, state.pending)}. ${TITLES[kind]}`}
      aria-live="polite"
      onClick={() => void checkConnection()}
    >
      <span className="dot" aria-hidden="true" />
      {label(kind, state.pending)}
    </button>
  );
}
