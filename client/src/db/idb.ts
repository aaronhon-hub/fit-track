/**
 * IndexedDB Initialisation
 *
 * Implements the full store + index schema from DATA_MODELS.md §4.
 * All store names, keyPaths, index names, and multiEntry flags are
 * authoritative — do not change without a version bump and migration.
 *
 * DB_VERSION history:
 *   1 — Sprint 1/2: initial schema (all 10 stores)
 */

const DB_NAME    = 'adaptive_fitness_coach';
const DB_VERSION = 1;

// ── Singleton promise ─────────────────────────────────────────────────────────
// Ensures the database is opened exactly once per app session.

let _dbPromise: Promise<IDBDatabase> | null = null;

export function getDB(): Promise<IDBDatabase> {
  if (!_dbPromise) {
    _dbPromise = openDB();
  }
  return _dbPromise;
}

// ── Open + upgrade ────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      // Version 1 — full initial schema
      if (oldVersion < 1) {
        createV1Stores(db);
      }

      // Future migrations: add `if (oldVersion < 2) { ... }` blocks here.
      // Never drop stores without explicit ADR approval.
    };

    request.onsuccess  = (e) => resolve((e.target as IDBOpenDBRequest).result);
    request.onerror    = (e) => reject((e.target as IDBOpenDBRequest).error);
    request.onblocked  = ()  => console.warn('[IDB] Database upgrade blocked — close other tabs');
  });
}

function createV1Stores(db: IDBDatabase): void {
  // ── user_profile ───────────────────────────────────────────────────────────
  // Single record per user. No indexes needed — always accessed by user_id key.
  db.createObjectStore('user_profile', { keyPath: 'user_id' });

  // ── exercise_library ───────────────────────────────────────────────────────
  // Static curated content. Seeded at install from bundled JSON.
  // Never written at runtime.
  {
    const store = db.createObjectStore('exercise_library', { keyPath: 'exercise_id' });
    store.createIndex('by_pattern',          'movement_pattern',   { multiEntry: false });
    store.createIndex('by_equipment',        'equipment_required', { multiEntry: true  });
    store.createIndex('by_experience',       'experience_level',   { multiEntry: false });
    store.createIndex('by_contraindication', 'contraindications',  { multiEntry: true  });
  }

  // ── cycle_configs ──────────────────────────────────────────────────────────
  {
    const store = db.createObjectStore('cycle_configs', { keyPath: 'id' });
    // Primary lookup: get a specific cycle for a user
    store.createIndex('by_user_cycle', ['user_id', 'cycle_number'], { multiEntry: false });
  }

  // ── session_plans ──────────────────────────────────────────────────────────
  {
    const store = db.createObjectStore('session_plans', { keyPath: 'id' });
    store.createIndex('by_cycle',  ['user_id', 'cycle_id'],    { multiEntry: false });
    store.createIndex('by_date',   ['user_id', 'planned_date'],{ multiEntry: false });
    store.createIndex('by_status', 'status',                   { multiEntry: false });
  }

  // ── session_logs ───────────────────────────────────────────────────────────
  {
    const store = db.createObjectStore('session_logs', { keyPath: 'id' });
    store.createIndex('by_cycle', ['user_id', 'cycle_id'], { multiEntry: false });
    store.createIndex('by_date',  ['user_id', 'date'],     { multiEntry: false });
    store.createIndex('by_type',  'session_type',          { multiEntry: false });
  }

  // ── benchmark_records ──────────────────────────────────────────────────────
  {
    const store = db.createObjectStore('benchmark_records', { keyPath: 'id' });
    store.createIndex('by_user_cycle', ['user_id', 'cycle_number'], { multiEntry: false });
    store.createIndex('by_date',       ['user_id', 'date'],         { multiEntry: false });
  }

  // ── life_stress_checkins ───────────────────────────────────────────────────
  {
    const store = db.createObjectStore('life_stress_checkins', { keyPath: 'id' });
    store.createIndex('by_cycle', ['user_id', 'cycle_id'], { multiEntry: false });
  }

  // ── cycle_evaluations ─────────────────────────────────────────────────────
  {
    const store = db.createObjectStore('cycle_evaluations', { keyPath: 'id' });
    store.createIndex('by_user_cycle', ['user_id', 'cycle_number'], { multiEntry: false });
  }

  // ── llm_call_log ──────────────────────────────────────────────────────────
  // Append-only audit log. Never read during normal runtime.
  {
    const store = db.createObjectStore('llm_call_log', { keyPath: 'id' });
    store.createIndex('by_workflow',  ['user_id', 'workflow'], { multiEntry: false });
    store.createIndex('by_timestamp', 'triggered_at',          { multiEntry: false });
  }

  // ── hrv_records ───────────────────────────────────────────────────────────
  // Optional. Only populated with a connected wearable.
  {
    const store = db.createObjectStore('hrv_records', { keyPath: 'id' });
    store.createIndex('by_date', ['user_id', 'date'], { multiEntry: false });
  }
}

// ── Transaction helpers ───────────────────────────────────────────────────────
// Low-level primitives used by all repository classes.
// Prefer typed repository methods over calling these directly.

export type StoreName =
  | 'user_profile'
  | 'exercise_library'
  | 'cycle_configs'
  | 'session_plans'
  | 'session_logs'
  | 'benchmark_records'
  | 'life_stress_checkins'
  | 'cycle_evaluations'
  | 'llm_call_log'
  | 'hrv_records';

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

export async function idbTransaction(
  storeNames: StoreName | StoreName[],
  mode: IDBTransactionMode,
  callback: (tx: IDBTransaction) => Promise<unknown>,
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(storeNames, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(new Error('Transaction aborted'));
  });
  await callback(tx);
  await done;
}

// ── Exercise library seeding ──────────────────────────────────────────────────
// Called once at app install (from main.tsx after SW registration).
// Idempotent: skips if library already populated.

export async function seedExerciseLibraryIfEmpty(): Promise<void> {
  const db   = await getDB();
  const tx   = db.transaction('exercise_library', 'readonly');
  const store = tx.objectStore('exercise_library');
  const count = await idbRequest<number>(store.count());

  if (count > 0) {
    return; // Already seeded
  }

  // Load bundled exercise library JSON.
  // Vite will resolve this to /fit-tracker/exercise-library.json (precached by SW).
  const response = await fetch('/fit-tracker/exercise-library.json');
  if (!response.ok) {
    throw new Error(`Failed to load exercise library: ${response.status}`);
  }
  const exercises: unknown[] = await response.json();

  const writeTx = db.transaction('exercise_library', 'readwrite');
  const writeStore = writeTx.objectStore('exercise_library');
  for (const exercise of exercises) {
    writeStore.put(exercise);
  }
  await new Promise<void>((resolve, reject) => {
    writeTx.oncomplete = () => resolve();
    writeTx.onerror    = () => reject(writeTx.error);
  });

  console.log(`[IDB] Exercise library seeded: ${exercises.length} exercises`);
}
