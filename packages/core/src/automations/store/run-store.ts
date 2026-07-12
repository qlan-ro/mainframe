// packages/core/src/automations/store/run-store.ts
import { nanoid } from 'nanoid';
import type { AutomationDefinition, AutomationRunStatus } from '@qlan-ro/mainframe-types';
import type { AutomationDb } from '../db.js';
import type { AutomationCheckpoint, AutomationRunRecord, AutomationRunTriggerContext } from './types.js';

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

  loadResumable(): AutomationRunRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM automation_runs WHERE status IN ('running','waiting')`)
      .all() as RunRow[];
    return rows.map(rowToRun);
  }

  /**
   * Read-modify-write in one transaction. Run-level status is derived from
   * the returned checkpoint's `wakeAt` (non-null → waiting, null → running)
   * rather than tracked separately, so parking and waking are a single
   * source of truth. Each step's `outputs` is capped at 4 MB, mirroring v1
   * `run-store.ts:46` — an oversize write throws and rolls back untouched.
   */
  patchCheckpoint(runId: string, fn: (checkpoint: AutomationCheckpoint) => AutomationCheckpoint): AutomationRunRecord {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM automation_runs WHERE id = ?`).get(runId) as RunRow | undefined;
      if (!row) throw new Error(`automation run not found: ${runId}`);
      const next = fn(JSON.parse(row.checkpoint) as AutomationCheckpoint);
      assertStepOutputsWithinCap(next);
      const status: AutomationRunStatus = next.wakeAt !== null ? 'waiting' : 'running';
      this.db
        .prepare(`UPDATE automation_runs SET checkpoint = ?, status = ? WHERE id = ?`)
        .run(JSON.stringify(next), status, runId);
    });
    tx();
    const run = this.getRun(runId);
    if (!run) throw new Error(`automation run not found: ${runId}`);
    return run;
  }

  /** Folds `error` into the checkpoint and clears wakeAt in the same transaction as the terminal status. */
  finalizeRun(runId: string, status: TerminalStatus, error: string | null): AutomationRunRecord {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM automation_runs WHERE id = ?`).get(runId) as RunRow | undefined;
      if (!row) throw new Error(`automation run not found: ${runId}`);
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
