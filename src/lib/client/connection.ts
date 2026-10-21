"use client";

/**
 * Tiny store for the practice connection status: whether the server answered
 * the last request, whether a sync is running, and how many answers wait in
 * the outbox. `navigator.onLine` alone is not enough — a phone can be online
 * but away from the home network the server lives on.
 */
export type ConnectionState = {
  /** null until the first request settles. */
  serverReachable: boolean | null;
  syncing: boolean;
  pending: number;
};

let state: ConnectionState = { serverReachable: null, syncing: false, pending: 0 };
const listeners = new Set<() => void>();

function update(patch: Partial<ConnectionState>) {
  const next = { ...state, ...patch };
  if (
    next.serverReachable === state.serverReachable &&
    next.syncing === state.syncing &&
    next.pending === state.pending
  ) {
    return;
  }
  state = next;
  listeners.forEach((listener) => listener());
}

export const connection = {
  get: (): ConnectionState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setServerReachable: (serverReachable: boolean) => update({ serverReachable }),
  setSyncing: (syncing: boolean) => update({ syncing }),
  setPending: (pending: number) => update({ pending }),
};

export type ConnectionKind = "offline" | "unreachable" | "syncing" | "pending" | "synced";

/** Collapses the browser and server signals into one status for display. */
export function connectionKind(browserOnline: boolean, value: ConnectionState): ConnectionKind {
  if (!browserOnline) return "offline";
  if (value.serverReachable === false) return "unreachable";
  if (value.syncing) return "syncing";
  if (value.pending > 0) return "pending";
  return "synced";
}
