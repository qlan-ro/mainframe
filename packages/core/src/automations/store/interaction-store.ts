// packages/core/src/automations/store/interaction-store.ts
import { nanoid } from 'nanoid';
import type { AutomationFormField, AutomationInteractionStatus } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../../logger.js';
import type { AutomationDb } from '../db.js';
import type { RunStore } from './run-store.js';
import type { AutomationCheckpoint, AutomationInteractionRecord } from './types.js';

const logger = createChildLogger('automations:interaction-store');

interface InteractionRow {
  id: string;
  run_id: string;
  step_ref: string;
  title: string;
  fields: string;
  status: string;
  created_at: number;
  resolved_at: number | null;
}

/** v2 interactions never expire (spec: "answerable hours later") — only pending|answered|cancelled exist. */
type ClaimTarget = Extract<AutomationInteractionStatus, 'answered' | 'cancelled'>;

export class InteractionStore {
  constructor(
    private readonly db: AutomationDb,
    private readonly runStore: RunStore,
  ) {}

  create(args: {
    runId: string;
    stepRef: string;
    title: string;
    fields: AutomationFormField[];
  }): AutomationInteractionRecord {
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO automation_interactions (id, run_id, step_ref, title, fields, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(id, args.runId, args.stepRef, args.title, JSON.stringify(args.fields), Date.now());
    const record = this.get(id);
    if (!record) throw new Error('automation interaction insert failed');
    return record;
  }

  get(id: string): AutomationInteractionRecord | null {
    const row = this.db.prepare(`SELECT * FROM automation_interactions WHERE id = ?`).get(id) as
      | InteractionRow
      | undefined;
    return row ? rowToInteraction(row) : null;
  }

  findPendingForStep(runId: string, stepRef: string): AutomationInteractionRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM automation_interactions WHERE run_id = ? AND step_ref = ? AND status = 'pending'`)
      .get(runId, stepRef) as InteractionRow | undefined;
    return row ? rowToInteraction(row) : null;
  }

  listPending(): AutomationInteractionRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM automation_interactions WHERE status = 'pending' ORDER BY created_at`)
      .all() as InteractionRow[];
    return rows.map(rowToInteraction);
  }

  /** Atomically claim: pending → answered|cancelled. Returns false if already claimed. */
  claim(id: string, to: ClaimTarget): boolean {
    const res = this.db
      .prepare(`UPDATE automation_interactions SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'`)
      .run(to, Date.now(), id);
    return res.changes === 1;
  }

  /**
   * Claims pending→answered and applies `patchFn` to the run's checkpoint in
   * ONE transaction (contract §3) — a crash between the two writes can't
   * strand an `answered` interaction against a still-`waiting` step. Relies
   * on better-sqlite3's SAVEPOINT-based nested transactions: `runStore` and
   * this store share the same `db` connection, so `runStore.patchCheckpoint`
   * called from inside our transaction joins it rather than starting a new one.
   */
  resolveInOneTx(
    interactionId: string,
    answers: Record<string, unknown>,
    runId: string,
    patchFn: (checkpoint: AutomationCheckpoint, answers: Record<string, unknown>) => AutomationCheckpoint,
  ): AutomationInteractionRecord {
    const tx = this.db.transaction(() => {
      if (!this.claim(interactionId, 'answered')) {
        throw new Error(`interaction '${interactionId}' already answered or cancelled`);
      }
      this.runStore.patchCheckpoint(runId, (checkpoint) => patchFn(checkpoint, answers));
    });
    tx();
    const record = this.get(interactionId);
    if (!record) throw new Error(`automation interaction not found: ${interactionId}`);
    return record;
  }

  /** Bulk-claims every pending interaction for a run to cancelled (run-cancel path). Returns the count claimed. */
  cancelPendingForRun(runId: string): number {
    const res = this.db
      .prepare(
        `UPDATE automation_interactions SET status = 'cancelled', resolved_at = ? WHERE run_id = ? AND status = 'pending'`,
      )
      .run(Date.now(), runId);
    return res.changes;
  }
}

function rowToInteraction(row: InteractionRow): AutomationInteractionRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepRef: row.step_ref,
    title: row.title,
    fields: parseFields(row.fields, row.id),
    status: row.status as AutomationInteractionStatus,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

/** Defensive JSON-array parse (repo convention) — a single malformed row must not crash listing. */
function parseFields(raw: string, interactionId: string): AutomationFormField[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AutomationFormField[]) : [];
  } catch (err) {
    // Written exclusively by create() above; a parse failure means on-disk corruption, not a runtime input to validate.
    logger.warn({ err, interactionId }, 'automation_interactions.fields malformed JSON, defaulting to []');
    return [];
  }
}
