// packages/core/src/automations/store/run-store.ts
import { nanoid } from 'nanoid';
import type { AutomationDefinition, AutomationRunStatus } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../../logger.js';
import type { AutomationDb } from '../db.js';
import {
  AutomationRunTerminalError,
  TERMINAL_RUN_STATUSES,
  type AutomationCheckpoint,
  type AutomationRunRecord,
  type AutomationRunTriggerContext,
} from './types.js';

const logger = createChildLogger('automations:run-store');
const MAX_STEP_OUTPUT_BYTES = 4 * 1024 * 1024;

interface RunRow {
  id: string;
  automation_id: string;
  status: string;
  checkpoint: string;
  started_at: number;
  finished_at: number | null;
}

/** Terminal statuses `finalizeRun` may set. */
type TerminalStatus = Extract<AutomationRunStatus, 'succeeded' | 'failed' | 'cancelled'>;

export class RunStore {
  constructor(private readonly db: AutomationDb) {}

  /**
   * Freezes `definition` and `trigger` INSIDE the checkpoint (contract §2) —
   * advance() always re-walks checkpoint.definition, never the live
   * `automations` row, so a mid-run definition edit can't shift stepRefs.
   * `dedupKey` is null for manual runs: SQLite treats every NULL as distinct
   * in the (automation_id, trigger_dedup_key) unique index, so repeated
   * manual runs never collide (contract §3, Decision 13) while a repeat
   * scheduled/webhook fire with the same key loses the insert race.
   */
  createRun(
    automationId: string,
    definition: AutomationDefinition,
    trigger: AutomationRunTriggerContext,
    dedupKey: string | null,
  ): AutomationRunRecord {
    const id = nanoid();
    const checkpoint: AutomationCheckpoint = { definition, trigger, steps: {}, wakeAt: null, error: null };
    this.db
      .prepare(
        `INSERT INTO automation_runs (id, automation_id, status, trigger_dedup_key, checkpoint, started_at)
         VALUES (?, ?, 'running', ?, ?, ?)`,
      )
      .run(id, automationId, dedupKey, JSON.stringify(checkpoint), Date.now());
    const run = this.getRun(id);
    if (!run) throw new Error('automation run insert failed');
    return run;
  }

  getRun(id: string): AutomationRunRecord | null {
    const row = this.db.prepare(`SELECT * FROM automation_runs WHERE id = ?`).get(id) as RunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  listRuns(automationId: string, limit = 50): AutomationRunRecord[] {
    // rowid tie-breaks started_at (millisecond resolution ties on fast successive creates).
    const rows = this.db
      .prepare(`SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?`)
      .all(automationId, limit) as RunRow[];
    return rows.map(rowToRun);
  }

  /** All non-terminal runs for one automation, unbounded by listRuns' history limit — service.delete cancels every one of these before the automation row cascades them away. */
  listActiveRuns(automationId: string): AutomationRunRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM automation_runs WHERE automation_id = ? AND status IN ('running','waiting')`)
      .all(automationId) as RunRow[];
    return rows.map(rowToRun);
  }

  /**
   * Boot reconcile's entry point — a single row with corrupted checkpoint
   * JSON must not throw and abort reconciliation for every other resumable
   * run. A corrupt row is finalized failed in place (bypassing the broken
   * JSON) and excluded from the returned list.
   */
  loadResumable(): AutomationRunRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM automation_runs WHERE status IN ('running','waiting')`)
      .all() as RunRow[];
    const runs: AutomationRunRecord[] = [];
    for (const row of rows) {
      try {
        runs.push(rowToRun(row));
      } catch (err) {
        logger.error({ err, runId: row.id }, 'automation run has a corrupt checkpoint; finalizing failed');
        this.finalizeCorruptRun(row.id);
      }
    }
    return runs;
  }

  /** Runs `fn` in one transaction — store/interaction/agent-wait calls made from within `fn` join it via better-sqlite3 SAVEPOINTs since they share this connection (mirrors resolveInOneTx). */
  withTransaction(fn: () => void): void {
    this.db.transaction(fn)();
  }

  /**
   * Read-modify-write in one transaction. Refuses to touch an already
   * terminal run (contract: cancellation is authoritative) — a stale async
   * callback that lost the race with cancelRun must not resurrect it. Run-
   * level status is derived from the returned checkpoint (waiting when
   * `wakeAt` is set OR any step is itself `waiting` — an ask_me/ask_agent
   * park with no deadline carries a null wakeAt but must still report
   * waiting). Each step's `outputs` is capped at 4 MB, mirroring v1
   * `run-store.ts:46` — an oversize write throws and rolls back untouched.
   */
  patchCheckpoint(runId: string, fn: (checkpoint: AutomationCheckpoint) => AutomationCheckpoint): AutomationRunRecord {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM automation_runs WHERE id = ?`).get(runId) as RunRow | undefined;
      if (!row) throw new Error(`automation run not found: ${runId}`);
      assertNotTerminal(runId, row.status as AutomationRunStatus);
      const next = fn(JSON.parse(row.checkpoint) as AutomationCheckpoint);
      assertStepOutputsWithinCap(next);
      const status = deriveRunStatus(next);
      this.db
        .prepare(`UPDATE automation_runs SET checkpoint = ?, status = ? WHERE id = ?`)
        .run(JSON.stringify(next), status, runId);
    });
    tx();
    const run = this.getRun(runId);
    if (!run) throw new Error(`automation run not found: ${runId}`);
    return run;
  }

  /** Folds `error` into the checkpoint and clears wakeAt in the same transaction as the terminal status. Refuses to re-finalize an already terminal run. */
  finalizeRun(runId: string, status: TerminalStatus, error: string | null): AutomationRunRecord {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM automation_runs WHERE id = ?`).get(runId) as RunRow | undefined;
      if (!row) throw new Error(`automation run not found: ${runId}`);
      assertNotTerminal(runId, row.status as AutomationRunStatus);
      const checkpoint = JSON.parse(row.checkpoint) as AutomationCheckpoint;
      checkpoint.wakeAt = null;
      if (error !== null) checkpoint.error = error;
      this.db
        .prepare(`UPDATE automation_runs SET checkpoint = ?, status = ?, finished_at = ? WHERE id = ?`)
        .run(JSON.stringify(checkpoint), status, Date.now(), runId);
    });
    tx();
    const run = this.getRun(runId);
    if (!run) throw new Error(`automation run not found: ${runId}`);
    return run;
  }

  /** Overwrites a corrupt row's checkpoint with a minimal stub recording the corruption — the original JSON can't be parsed, let alone mutated. */
  private finalizeCorruptRun(runId: string): void {
    const stub: AutomationCheckpoint = {
      definition: { triggers: [], steps: [] },
      trigger: { kind: 'manual' },
      steps: {},
      wakeAt: null,
      error: 'corrupt checkpoint',
    };
    this.db
      .prepare(`UPDATE automation_runs SET checkpoint = ?, status = 'failed', finished_at = ? WHERE id = ?`)
      .run(JSON.stringify(stub), Date.now(), runId);
  }
}

function assertNotTerminal(runId: string, status: AutomationRunStatus): void {
  if (TERMINAL_RUN_STATUSES.has(status)) throw new AutomationRunTerminalError(runId, status);
}

function deriveRunStatus(checkpoint: AutomationCheckpoint): AutomationRunStatus {
  if (checkpoint.wakeAt !== null) return 'waiting';
  const hasWaitingStep = Object.values(checkpoint.steps).some((step) => step.status === 'waiting');
  return hasWaitingStep ? 'waiting' : 'running';
}

function assertStepOutputsWithinCap(checkpoint: AutomationCheckpoint): void {
  for (const [stepRef, step] of Object.entries(checkpoint.steps)) {
    if (step.outputs === null) continue;
    const bytes = Buffer.byteLength(JSON.stringify(step.outputs));
    if (bytes > MAX_STEP_OUTPUT_BYTES) {
      throw new Error(
        `step '${stepRef}' outputs too large (${bytes} bytes > ${MAX_STEP_OUTPUT_BYTES}); write large data to a file and pass the path`,
      );
    }
  }
}

function rowToRun(row: RunRow): AutomationRunRecord {
  return {
    id: row.id,
    automationId: row.automation_id,
    status: row.status as AutomationRunStatus,
    checkpoint: JSON.parse(row.checkpoint) as AutomationCheckpoint,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
