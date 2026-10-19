// Push the outbox, pull server changes, merge with last-write-wins.
import { useSyncExternalStore } from 'react';
import { db, getMeta, setMeta } from './db.ts';
import { SYNC_TABLES } from '../../shared/src/types.ts';
import type { Change, SyncRequest, SyncResponse } from '../../shared/src/types.ts';

/** 'locked': the server has a PIN and this device has no valid session. */
export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'locked';

export interface SyncStatus {
  state: SyncState;
  lastSync: number | null;
  error?: string;
}

const AUTO_SYNC_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 1_500;
const REQUEST_TIMEOUT_MS = 10_000;

let status: SyncStatus = { state: 'idle', lastSync: null };
const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => status,
  );
}

export function getSyncStatus(): SyncStatus {
  return status;
}

class LockedError extends Error {}

let running: Promise<void> | null = null;
let rerun = false;

/** Runs a sync now. Concurrent calls are coalesced into one follow-up run. */
export function syncNow(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerun = false;
        await runSync();
      } while (rerun);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function runSync() {
  if (!navigator.onLine) {
    setStatus({ state: 'offline' });
    return;
  }
  setStatus({ state: 'syncing', error: undefined });
  try {
    const outbox = await db.outbox.toArray();
    const changes: Change[] = [];
    for (const entry of outbox) {
      const record = await db.table(entry.table).get(entry.id);
      if (record) changes.push({ table: entry.table, record });
    }

    let since = await getMeta('cursor', 0);
    let first = true;
    for (;;) {
      const res = await post({ since, changes: first ? changes : [] });
      await merge(res, first ? outbox : []);
      since = res.cursor;
      first = false;
      if (!res.hasMore) break;
    }
    setStatus({ state: 'idle', lastSync: Date.now() });
  } catch (err) {
    if (err instanceof LockedError) {
      setStatus({ state: 'locked' });
      return;
    }
    const offline = err instanceof TypeError || (err as Error).name === 'AbortError';
    setStatus(offline ? { state: 'offline' } : { state: 'error', error: (err as Error).message });
  }
}

async function post(body: SyncRequest): Promise<SyncResponse> {
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 401) throw new LockedError();
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new TypeError('Server unreachable');
  if (!res.ok) throw new Error(`Sync failed: HTTP ${res.status}`);
  return res.json();
}

async function merge(res: SyncResponse, sent: { key: string; updatedAt: number }[]) {
  const tables = SYNC_TABLES.map((t) => db.table(t));
  await db.transaction('rw', [...tables, db.outbox, db.meta], async () => {
    for (const { table, record } of res.changes) {
      const local = await db.table(table).get(record.id);
      // A newer local edit (made while the request was in flight) wins and is pushed next time.
      if (local && local.updatedAt > record.updatedAt) continue;
      await db.table(table).put(record);
    }
    // Only clear outbox entries that weren't edited again since we sent them.
    for (const s of sent) {
      const current = await db.outbox.get(s.key);
      if (current && current.updatedAt === s.updatedAt) await db.outbox.delete(s.key);
    }
    await setMeta('cursor', res.cursor);
  });
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

/** Debounced sync after local edits. */
export function scheduleSync() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void syncNow(), DEBOUNCE_MS);
}

/** Starts background syncing: on reconnect, when the app becomes visible, and periodically. */
export function startAutoSync() {
  window.addEventListener('online', () => void syncNow());
  window.addEventListener('offline', () => setStatus({ state: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, AUTO_SYNC_INTERVAL_MS);
}
