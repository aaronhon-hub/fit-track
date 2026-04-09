/**
 * Repository Layer
 *
 * Generic IDBRepository<T> base class + typed repositories for every store.
 * All engine modules interact with IndexedDB through these repositories only —
 * never through raw IDB transactions.
 *
 * Query patterns match DATA_MODELS.md §6 (Rule Engine Query Patterns).
 */

import { getDB, idbRequest, type StoreName } from './idb';

// ── Types (DATA_MODELS.md §3) ─────────────────────────────────────────────────
// Note: when dataModels.ts (Sprint 1/2) is integrated, import enum types from
// './dataModels' and use them as typed query parameters in the methods below.
// Minimal inline types for the repository layer.
// Full interfaces live in dataModels.ts.

interface HasId    { id: string }
interface HasUserId { user_id: string }

// ── Generic Repository ────────────────────────────────────────────────────────

export class IDBRepository<T extends Record<string, unknown>> {
  protected storeName: StoreName;

  constructor(storeName: StoreName) {
    this.storeName = storeName;
  }

  protected async store(mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
    const db = await getDB();
    return db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  // ── Core CRUD ──────────────────────────────────────────────────────────────

  async get(key: IDBValidKey): Promise<T | undefined> {
    const s = await this.store('readonly');
    return idbRequest<T | undefined>(s.get(key));
  }

  async put(record: T): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(this.storeName, 'readwrite');
    await idbRequest(tx.objectStore(this.storeName).put(record));
  }

  async putMany(records: T[] | Record<string, unknown>[]): Promise<void> {
    if (records.length === 0) return;
    const db = await getDB();
    const tx = db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);
    for (const record of records) {
      store.put(record);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }

  async delete(key: IDBValidKey): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(this.storeName, 'readwrite');
    await idbRequest(tx.objectStore(this.storeName).delete(key));
  }

  async getAll(): Promise<T[]> {
    const s = await this.store('readonly');
    return idbRequest<T[]>(s.getAll());
  }

  async count(): Promise<number> {
    const s = await this.store('readonly');
    return idbRequest<number>(s.count());
  }

  // ── Index queries ──────────────────────────────────────────────────────────

  protected async getByIndex(
    indexName: string,
    key: IDBValidKey | IDBKeyRange,
  ): Promise<T[]> {
    const s = await this.store('readonly');
    return idbRequest<T[]>(s.index(indexName).getAll(key));
  }

  protected async getOneByIndex(
    indexName: string,
    key: IDBValidKey | IDBKeyRange,
  ): Promise<T | undefined> {
    const s = await this.store('readonly');
    return idbRequest<T | undefined>(s.index(indexName).get(key));
  }

  // ── Sync support ───────────────────────────────────────────────────────────
  // Returns all records modified since a given ISO datetime string.
  // Requires records to have an updated_at or equivalent timestamp field.
  // Used by syncClient to compute the delta push payload.

  async getAllModifiedSince(isoTimestamp: string): Promise<T[]> {
    const all = await this.getAll();
    return all.filter((r) => {
      const ts = (r as Record<string, unknown>)['updated_at']
              ?? (r as Record<string, unknown>)['completed_at']
              ?? (r as Record<string, unknown>)['generated_at']
              ?? (r as Record<string, unknown>)['triggered_at']
              ?? (r as Record<string, unknown>)['date'];
      return typeof ts === 'string' && ts > isoTimestamp;
    });
  }
}

// ── UserProfile Repository ────────────────────────────────────────────────────

export class UserProfileRepository extends IDBRepository<Record<string, unknown>> {
  constructor() { super('user_profile'); }

  async getProfile(userId: string): Promise<Record<string, unknown> | undefined> {
    return this.get(userId);
  }

  async saveProfile(profile: Record<string, unknown>): Promise<void> {
    return this.put(profile);
  }

  // Returns the first (only) profile in the store.
  // Single-user app — there is always exactly one profile.
  async getActiveProfile(): Promise<Record<string, unknown> | undefined> {
    const all = await this.getAll();
    return all[0];
  }
}

// ── ExerciseLibrary Repository ────────────────────────────────────────────────

export class ExerciseLibraryRepository extends IDBRepository<Record<string, unknown>> {
  constructor() { super('exercise_library'); }

  async getExercise(exerciseId: string): Promise<Record<string, unknown> | undefined> {
    return this.get(exerciseId);
  }

  async getByMovementPattern(pattern: string): Promise<Record<string, unknown>[]> {
    return this.getByIndex('by_pattern', pattern);
  }

  // Returns exercises that have all the given equipment tags in equipment_required.
  // Filters client-side after the index lookup since IDB doesn't support AND queries
  // across a multi-entry index. Index narrows the candidate set; filter refines it.
  async getByEquipmentTag(tag: string): Promise<Record<string, unknown>[]> {
    return this.getByIndex('by_equipment', tag);
  }

  async getByExperienceLevel(level: string): Promise<Record<string, unknown>[]> {
    return this.getByIndex('by_experience', level);
  }

  async getByContraindication(tag: string): Promise<Record<string, unknown>[]> {
    return this.getByIndex('by_contraindication', tag);
  }
}

// ── CycleConfig Repository ────────────────────────────────────────────────────

export class CycleConfigRepository extends IDBRepository<HasId & HasUserId & Record<string, unknown>> {
  constructor() { super('cycle_configs'); }

  async getCycle(id: string): Promise<Record<string, unknown> | undefined> {
    return this.get(id);
  }

  // Primary lookup: get a specific cycle by user + cycle number
  async getCycleByNumber(
    userId: string,
    cycleNumber: number,
  ): Promise<Record<string, unknown> | undefined> {
    return this.getOneByIndex('by_user_cycle', [userId, cycleNumber]);
  }

  // Get all cycles for a user (for history/dashboard)
  async getAllCyclesForUser(userId: string): Promise<Record<string, unknown>[]> {
    const all = await this.getAll();
    return all
      .filter(c => c.user_id === userId)
      .sort((a, b) => (a.cycle_number as number) - (b.cycle_number as number));
  }

  async getLatestCycle(userId: string): Promise<Record<string, unknown> | undefined> {
    const cycles = await this.getAllCyclesForUser(userId);
    return cycles[cycles.length - 1];
  }
}

// ── SessionPlan Repository ────────────────────────────────────────────────────

export class SessionPlanRepository extends IDBRepository<HasId & HasUserId & Record<string, unknown>> {
  constructor() { super('session_plans'); }

  // Load all planned sessions for a cycle (for session machine init)
  async getPlansForCycle(userId: string, cycleId: string): Promise<Record<string, unknown>[]> {
    return this.getByIndex('by_cycle', [userId, cycleId]);
  }

  // Today's session lookup — primary runtime query
  async getPlanForDate(userId: string, date: string): Promise<Record<string, unknown> | undefined> {
    return this.getOneByIndex('by_date', [userId, date]);
  }

  // Find sessions by status (e.g. find all 'planned' sessions)
  async getPlansByStatus(status: string): Promise<Record<string, unknown>[]> {
    return this.getByIndex('by_status', status);
  }
}

// ── SessionLog Repository ─────────────────────────────────────────────────────

export class SessionLogRepository extends IDBRepository<HasId & HasUserId & Record<string, unknown>> {
  constructor() { super('session_logs'); }

  // Load all session logs for cycle evaluation (W3 input)
  async getLogsForCycle(userId: string, cycleId: string): Promise<Record<string, unknown>[]> {
    return this.getByIndex('by_cycle', [userId, cycleId]);
  }

  // History view and "today's completed session" check
  async getLogForDate(userId: string, date: string): Promise<Record<string, unknown> | undefined> {
    return this.getOneByIndex('by_date', [userId, date]);
  }

  // Filter benchmark sessions for delta computation
  async getBenchmarkLogs(userId: string): Promise<Record<string, unknown>[]> {
    const byType = await this.getByIndex('by_type', 'benchmark_tier_a');
    const byTypeB = await this.getByIndex('by_type', 'benchmark_tier_b');
    const baseline = await this.getByIndex('by_type', 'benchmark_baseline');
    return [...baseline, ...byType, ...byTypeB].filter(l => l.user_id === userId);
  }

  async getLastCompletedLog(userId: string): Promise<Record<string, unknown> | undefined> {
    const all = await this.getAll();
    const completed = all
      .filter(l => l.user_id === userId && l.completed_at != null)
      .sort((a, b) => ((b.date as string) > (a.date as string) ? 1 : -1));
    return completed[0];
  }
}

// ── BenchmarkRecord Repository ────────────────────────────────────────────────

export class BenchmarkRecordRepository extends IDBRepository<HasId & HasUserId & Record<string, unknown>> {
  constructor() { super('benchmark_records'); }

  // Primary delta computation query: current vs previous cycle
  async getRecordForCycle(
    userId: string,
    cycleNumber: number,
  ): Promise<Record<string, unknown> | undefined> {
    return this.getOneByIndex('by_user_cycle', [userId, cycleNumber]);
  }

  // Trend chart data
  async getAllRecordsForUser(userId: string): Promise<Record<string, unknown>[]> {
    const all = await this.getAll();
    return all
      .filter(r => r.user_id === userId)
      .sort((a, b) => (a.cycle_number as number) - (b.cycle_number as number));
  }

  async getLatestRecord(userId: string): Promise<Record<string, unknown> | undefined> {
    const records = await this.getAllRecordsForUser(userId);
    return records[records.length - 1];
  }
}

// ── LifeStressCheckIn Repository ──────────────────────────────────────────────

export class LifeStressCheckInRepository extends IDBRepository<HasId & HasUserId & Record<string, unknown>> {
  constructor() { super('life_stress_checkins'); }

  async getCheckInsForCycle(userId: string, cycleId: string): Promise<Record<string, unknown>[]> {
    return this.getByIndex('by_cycle', [userId, cycleId]);
  }
}

// ── CycleEvaluation Repository ────────────────────────────────────────────────

export class CycleEvaluationRepository extends IDBRepository<HasId & HasUserId & Record<string, unknown>> {
  constructor() { super('cycle_evaluations'); }

  async getEvaluationForCycle(
    userId: string,
    cycleNumber: number,
  ): Promise<Record<string, unknown> | undefined> {
    return this.getOneByIndex('by_user_cycle', [userId, cycleNumber]);
  }

  async getAllEvaluationsForUser(userId: string): Promise<Record<string, unknown>[]> {
    const all = await this.getAll();
    return all
      .filter(e => e.user_id === userId)
      .sort((a, b) => (a.cycle_number as number) - (b.cycle_number as number));
  }
}

// ── LLMCallLog Repository ─────────────────────────────────────────────────────

export class LLMCallLogRepository extends IDBRepository<HasId & HasUserId & Record<string, unknown>> {
  constructor() { super('llm_call_log'); }

  // Append only — no update or delete methods exposed.
  // Callers must ensure the record has id and user_id fields (per DATA_MODELS.md §3.9).
  async append(record: Record<string, unknown>): Promise<void> {
    return this.put(record as HasId & HasUserId & Record<string, unknown>);
  }

  async getLogsForWorkflow(userId: string, workflow: string): Promise<Record<string, unknown>[]> {
    return this.getByIndex('by_workflow', [userId, workflow]);
  }

  // Cost audit: all logs in chronological order
  async getAllChronological(): Promise<Record<string, unknown>[]> {
    const s = await this.store('readonly');
    return idbRequest<Record<string, unknown>[]>(s.index('by_timestamp').getAll());
  }
}

// ── HRVRecord Repository ──────────────────────────────────────────────────────

export class HRVRecordRepository extends IDBRepository<HasId & HasUserId & Record<string, unknown>> {
  constructor() { super('hrv_records'); }

  // 7-day window for rolling baseline computation (RECOVERY_READINESS_SPEC §3)
  async getRecentRecords(userId: string, days = 7): Promise<Record<string, unknown>[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const all = await this.getAll();
    return all
      .filter(r => r.user_id === userId && (r.date as string) >= cutoffStr)
      .sort((a, b) => ((a.date as string) < (b.date as string) ? -1 : 1));
  }
}

// ── Singleton repository instances ────────────────────────────────────────────
// Import these throughout the app — never instantiate repositories directly.

export const userProfileRepo      = new UserProfileRepository();
export const exerciseLibraryRepo  = new ExerciseLibraryRepository();
export const cycleConfigRepo      = new CycleConfigRepository();
export const sessionPlanRepo      = new SessionPlanRepository();
export const sessionLogRepo       = new SessionLogRepository();
export const benchmarkRecordRepo  = new BenchmarkRecordRepository();
export const lifeStressRepo       = new LifeStressCheckInRepository();
export const cycleEvaluationRepo  = new CycleEvaluationRepository();
export const llmCallLogRepo       = new LLMCallLogRepository();
export const hrvRecordRepo        = new HRVRecordRepository();
