import type { ExerciseType } from "@/domain/review/exercises";
import type { ReviewResult } from "@/domain/review/schedule";
import type { PracticeSnapshot } from "@/domain/review/snapshot";

/** An answer recorded on the device and waiting to be synced. */
export type PendingAttempt = {
  attemptId: string;
  sessionId: string | null;
  vocabularyItemId: string;
  exerciseType: ExerciseType;
  bankItemId: string | null;
  submittedAnswer: string | null;
  usedHint: boolean;
  skipped: boolean;
  latencyMs: number | null;
  answeredAt: number;
  /** Extra practice beyond the schedule (absent on older records). */
  extra?: boolean;
  /** The locally computed result (the server re-grades). */
  result: ReviewResult;
};

export type PendingSession = {
  id: string;
  startedAt: number;
  finishedAt: number | null;
};

/** Persistence for offline practice; IndexedDB in the browser, memory in tests. */
export interface OfflineStore {
  getSnapshot(): Promise<PracticeSnapshot | null>;
  putSnapshot(snapshot: PracticeSnapshot): Promise<void>;
  listAttempts(): Promise<PendingAttempt[]>;
  putAttempt(attempt: PendingAttempt): Promise<void>;
  deleteAttempts(ids: string[]): Promise<void>;
  listSessions(): Promise<PendingSession[]>;
  putSession(session: PendingSession): Promise<void>;
  deleteSessions(ids: string[]): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryOfflineStore implements OfflineStore {
  private snapshot: PracticeSnapshot | null = null;
  private readonly attempts = new Map<string, PendingAttempt>();
  private readonly sessions = new Map<string, PendingSession>();

  async getSnapshot() {
    return this.snapshot ? structuredClone(this.snapshot) : null;
  }
  async putSnapshot(snapshot: PracticeSnapshot) {
    this.snapshot = structuredClone(snapshot);
  }
  async listAttempts() {
    return [...this.attempts.values()].sort((a, b) => a.answeredAt - b.answeredAt);
  }
  async putAttempt(attempt: PendingAttempt) {
    this.attempts.set(attempt.attemptId, { ...attempt });
  }
  async deleteAttempts(ids: string[]) {
    for (const id of ids) this.attempts.delete(id);
  }
  async listSessions() {
    return [...this.sessions.values()];
  }
  async putSession(session: PendingSession) {
    this.sessions.set(session.id, { ...session });
  }
  async deleteSessions(ids: string[]) {
    for (const id of ids) this.sessions.delete(id);
  }
  async clear() {
    this.snapshot = null;
    this.attempts.clear();
    this.sessions.clear();
  }
}

const DB_PREFIX = "cards-no-cards";

/** Each user gets their own offline database on a shared device. */
export function offlineDbName(userId: string): string {
  return `${DB_PREFIX}:${userId}`;
}

/** Deletes a user's offline database (used on sign-out). */
export function deleteOfflineDb(userId: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(offlineDbName(userId));
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}
const DB_VERSION = 1;
const KV = "kv";
const ATTEMPTS = "attempts";
const SESSIONS = "sessions";
const SNAPSHOT_KEY = "snapshot";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IndexedDbOfflineStore implements OfflineStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly name: string) {}

  /** Closes the connection so the database can be deleted. */
  async close(): Promise<void> {
    if (!this.dbPromise) return;
    (await this.dbPromise.catch(() => null))?.close();
    this.dbPromise = null;
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
        if (!db.objectStoreNames.contains(ATTEMPTS)) {
          db.createObjectStore(ATTEMPTS, { keyPath: "attemptId" });
        }
        if (!db.objectStoreNames.contains(SESSIONS)) {
          db.createObjectStore(SESSIONS, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }

  private async read<T>(store: string, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const tx = (await this.db()).transaction(store, "readonly");
    return promisify(run(tx.objectStore(store)));
  }

  private async write(store: string, run: (s: IDBObjectStore) => void): Promise<void> {
    const tx = (await this.db()).transaction(store, "readwrite");
    run(tx.objectStore(store));
    await done(tx);
  }

  async getSnapshot() {
    return (
      ((await this.read(KV, (s) => s.get(SNAPSHOT_KEY))) as PracticeSnapshot | undefined) ?? null
    );
  }
  putSnapshot(snapshot: PracticeSnapshot) {
    return this.write(KV, (s) => s.put(snapshot, SNAPSHOT_KEY));
  }
  async listAttempts() {
    const rows = (await this.read(ATTEMPTS, (s) => s.getAll())) as PendingAttempt[];
    return rows.sort((a, b) => a.answeredAt - b.answeredAt);
  }
  putAttempt(attempt: PendingAttempt) {
    return this.write(ATTEMPTS, (s) => s.put(attempt));
  }
  deleteAttempts(ids: string[]) {
    return this.write(ATTEMPTS, (s) => ids.forEach((id) => s.delete(id)));
  }
  async listSessions() {
    return (await this.read(SESSIONS, (s) => s.getAll())) as PendingSession[];
  }
  putSession(session: PendingSession) {
    return this.write(SESSIONS, (s) => s.put(session));
  }
  deleteSessions(ids: string[]) {
    return this.write(SESSIONS, (s) => ids.forEach((id) => s.delete(id)));
  }
  async clear() {
    const tx = (await this.db()).transaction([KV, ATTEMPTS, SESSIONS], "readwrite");
    tx.objectStore(KV).clear();
    tx.objectStore(ATTEMPTS).clear();
    tx.objectStore(SESSIONS).clear();
    await done(tx);
  }
}
