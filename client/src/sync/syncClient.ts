/**
 * Sync Client
 *
 * Delta sync between IndexedDB (local) and NAS JSON file store (backup).
 * Protocol:
 *   PUSH — send all records modified since last successful push timestamp
 *   PULL — receive all records changed on the server since last pull timestamp
 *
 * Conflict resolution: last-write-wins by timestamp (single-user, single-device).
 *
 * Sync is triggered:
 *   - On app foreground (visibilitychange → visible)
 *   - After session complete
 *   - After cycle evaluation complete
 *
 * Never called during active workout execution (ADR-006).
 */

import {
  userProfileRepo,
  cycleConfigRepo,
  sessionLogRepo,
  benchmarkRecordRepo,
  cycleEvaluationRepo,
  type IDBRepository,
} from '../db/repositories';

// ── Config ────────────────────────────────────────────────────────────────────

const SYNC_BASE = '/api/fit-tracker/sync';
const SYNC_TIMESTAMP_KEY = 'fit_tracker_last_sync';

// Stores included in sync. exercise_library is static (not synced).
// llm_call_log is audit-only and too large to sync on every session.
const SYNC_STORES = [
  { name: 'user_profile',     repo: userProfileRepo      },
  { name: 'cycle_configs',    repo: cycleConfigRepo      },
  { name: 'session_logs',     repo: sessionLogRepo       },
  { name: 'benchmark_records',repo: benchmarkRecordRepo  },
  { name: 'cycle_evaluations',repo: cycleEvaluationRepo  },
] as const;

// ── Auth ──────────────────────────────────────────────────────────────────────
// Bearer token is stored in localStorage (set once at first app open via settings).
// Never hardcoded in source.

function getAuthToken(): string | null {
  return localStorage.getItem('fit_tracker_token');
}

function authHeaders(): HeadersInit {
  const token = getAuthToken();
  return {
    'Content-Type': 'text/plain',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// ── Timestamp management ──────────────────────────────────────────────────────

function getLastSyncTimestamp(): string {
  return localStorage.getItem(SYNC_TIMESTAMP_KEY) ?? '1970-01-01T00:00:00.000Z';
}

function setLastSyncTimestamp(ts: string): void {
  localStorage.setItem(SYNC_TIMESTAMP_KEY, ts);
}

// ── Health check ──────────────────────────────────────────────────────────────

export async function checkSyncHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${SYNC_BASE}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Push ──────────────────────────────────────────────────────────────────────

export interface SyncPushResult {
  ok: boolean;
  recordsPushed: number;
  error?: string;
}

export async function syncPush(userId: string): Promise<SyncPushResult> {
  const token = getAuthToken();
  if (!token) {
    return { ok: false, recordsPushed: 0, error: 'No auth token configured' };
  }

  const since = getLastSyncTimestamp();
  const payload: Record<string, unknown[]> = {};
  let total = 0;

  for (const { name, repo } of SYNC_STORES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modified = await (repo as IDBRepository<any>).getAllModifiedSince(since);
    // Filter to this user's records only
    const userRecords = modified.filter(
      (r: Record<string, unknown>) => r.user_id === userId || name === 'user_profile',
    );
    if (userRecords.length > 0) {
      payload[name] = userRecords;
      total += userRecords.length;
    }
  }

  if (total === 0) {
    // Nothing to push — update timestamp to avoid re-scanning next time
    setLastSyncTimestamp(new Date().toISOString());
    return { ok: true, recordsPushed: 0 };
  }

  try {
    const res = await fetch(`${SYNC_BASE}/push`, {
      method:  'POST',
      headers: authHeaders(),
      body:    JSON.stringify({ userId, payload, clientTs: new Date().toISOString() }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, recordsPushed: 0, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    }

    setLastSyncTimestamp(new Date().toISOString());
    console.log(`[Sync] Pushed ${total} records across ${Object.keys(payload).length} stores`);
    return { ok: true, recordsPushed: total };
  } catch (err) {
    return { ok: false, recordsPushed: 0, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ── Pull ──────────────────────────────────────────────────────────────────────

export interface SyncPullResult {
  ok: boolean;
  recordsReceived: number;
  error?: string;
}

export async function syncPull(userId: string): Promise<SyncPullResult> {
  const token = getAuthToken();
  if (!token) {
    return { ok: false, recordsReceived: 0, error: 'No auth token configured' };
  }

  const since = getLastSyncTimestamp();

  try {
    const res = await fetch(
      `${SYNC_BASE}/pull?userId=${encodeURIComponent(userId)}&since=${encodeURIComponent(since)}`,
      { headers: authHeaders() },
    );

    if (!res.ok) {
      return { ok: false, recordsReceived: 0, error: `HTTP ${res.status}` };
    }

    const data = await res.json() as {
      payload: Record<string, Record<string, unknown>[]>;
    };

    let total = 0;
    for (const { name, repo } of SYNC_STORES) {
      const incoming = data.payload[name] ?? [];
      if (incoming.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (repo as IDBRepository<any>).putMany(incoming);
        total += incoming.length;
      }
    }

    if (total > 0) {
      console.log(`[Sync] Pulled ${total} records from server`);
    }
    return { ok: true, recordsReceived: total };
  } catch (err) {
    return { ok: false, recordsReceived: 0, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ── Full sync (push then pull) ────────────────────────────────────────────────

export async function sync(userId: string): Promise<{ push: SyncPushResult; pull: SyncPullResult }> {
  const push = await syncPush(userId);
  // Pull even if push partially failed — we want to receive server data regardless
  const pull = await syncPull(userId);
  return { push, pull };
}

// ── Visibility-based auto-sync ────────────────────────────────────────────────
// Call this once from main.tsx after user profile is loaded.

export function registerAutoSync(getUserId: () => string | null): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible') {
      const userId = getUserId();
      if (userId) {
        // Fire and forget — sync failures are non-blocking
        sync(userId).catch(err => console.warn('[Sync] Auto-sync failed:', err));
      }
    }
  };

  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
