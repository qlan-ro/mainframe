import { CronExpressionParser } from 'cron-parser';
import type { Logger } from 'pino';
import type { WorkflowDb } from '../db.js';

export type OnMissed = 'skip' | 'run_once';

interface CronMeta {
  cron: string;
  onMissed: OnMissed;
}

/**
 * Sweep-based cron scheduler. Fires due cron triggers on each sweep(now) call.
 * Never uses setTimeout — survives laptop sleep.
 *
 * on_missed semantics:
 *   'skip'     — if next_fire_at is stale (older than 5 min or one interval), drop the fire.
 *   'run_once' — fire exactly one make-up run even if many were missed.
 */
export class CronScheduler {
  private readonly crons = new Map<string, CronMeta>();

  constructor(
    private readonly db: WorkflowDb,
    private readonly logger: Logger,
    private readonly fire: (workflowId: string, triggerIndex: number) => void,
  ) {}

  /**
   * Register or refresh a schedule row. Computes the first next_fire_at from now.
   */
  arm(workflowId: string, triggerIndex: number, cron: string, onMissed: OnMissed, now: number): void {
    const next = this.nextAfter(cron, now);
    this.db
      .prepare(`INSERT OR REPLACE INTO trigger_state (workflow_id, trigger_index, next_fire_at) VALUES (?, ?, ?)`)
      .run(workflowId, triggerIndex, next);
    this.crons.set(this.key(workflowId, triggerIndex), { cron, onMissed });
  }

  /** Remove all trigger rows and in-memory state for a workflow. */
  disarm(workflowId: string): void {
    this.db.prepare(`DELETE FROM trigger_state WHERE workflow_id = ?`).run(workflowId);
    for (const k of [...this.crons.keys()]) {
      if (k.startsWith(`${workflowId}:`)) {
        this.crons.delete(k);
      }
    }
  }

  /**
   * Process all due triggers. Call this on a fixed interval (e.g. every 30 s).
   *
   * For each row where next_fire_at <= now:
   *   1. Advance next_fire_at to the next future occurrence.
   *   2. Compute how stale the missed fire was (now - old next_fire_at).
   *   3. If stale AND on_missed === 'skip': log and skip.
   *   4. Otherwise: fire exactly once (covers both timely and run_once make-up).
   */
  sweep(now: number): void {
    const due = this.db
      .prepare(`SELECT workflow_id, trigger_index, next_fire_at FROM trigger_state WHERE next_fire_at <= ?`)
      .all(now) as Array<{ workflow_id: string; trigger_index: number; next_fire_at: number }>;

    for (const row of due) {
      const meta = this.crons.get(this.key(row.workflow_id, row.trigger_index));
      if (!meta) {
        // Stale DB row with no in-memory registration — clean it up.
        this.db
          .prepare(`DELETE FROM trigger_state WHERE workflow_id = ? AND trigger_index = ?`)
          .run(row.workflow_id, row.trigger_index);
        continue;
      }

      const next = this.nextAfter(meta.cron, now);
      this.db
        .prepare(`UPDATE trigger_state SET next_fire_at = ? WHERE workflow_id = ? AND trigger_index = ?`)
        .run(next, row.workflow_id, row.trigger_index);

      const missedMs = now - row.next_fire_at;
      const oneIntervalMs = next - now;
      const isStale = missedMs > Math.min(oneIntervalMs, 5 * 60_000);

      if (isStale && meta.onMissed === 'skip') {
        this.logger.info({ workflowId: row.workflow_id, missedMs }, 'cron fire skipped (on_missed: skip)');
        continue;
      }

      try {
        this.fire(row.workflow_id, row.trigger_index);
      } catch (err) {
        this.logger.error({ err, workflowId: row.workflow_id }, 'cron fire callback failed');
      }
    }
  }

  private nextAfter(cron: string, after: number): number {
    return CronExpressionParser.parse(cron, { currentDate: new Date(after), tz: 'UTC' })
      .next()
      .getTime();
  }

  private key(workflowId: string, triggerIndex: number): string {
    return `${workflowId}:${triggerIndex}`;
  }
}
