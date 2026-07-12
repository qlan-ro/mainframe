// packages/core/src/automations/triggers/scheduler.ts
import { CronExpressionParser } from 'cron-parser';
import type { Logger } from 'pino';
import type { AutomationDb } from '../db.js';

export type OnMissed = 'skip' | 'run_once';

interface CronMeta {
  cron: string;
  onMissed: OnMissed;
}

interface TriggerStateRow {
  automation_id: string;
  trigger_id: string;
  next_fire_at: number;
}

/**
 * Sweep-based cron scheduler for `automation_runs` schedule triggers. Fires
 * due crons on each `sweep(now)` call — never `setTimeout`, so it survives
 * laptop sleep. Adapted from v1's `workflows/triggers/scheduler.ts`: keyed by
 * `(automation_id, trigger_id)` instead of `(workflow_id, trigger_index)`,
 * and evaluated in **local time** (contract §7 — v1 pinned `tz: 'UTC'`, v2
 * schedules run wall-clock local).
 *
 * The fire callback receives the exact `scheduledFor` slot that came due
 * (not the next occurrence), so the caller can build the trigger dedup key
 * `<triggerId>|<scheduledFor>` for `RunStore.createRun` — a duplicate fire
 * (e.g. a second daemon racing on a stale `trigger_state` row) computes the
 * same key and loses the insert race deterministically (contract §3); a
 * throw from the fire callback is caught and logged, never crashes the sweep.
 *
 * on_missed semantics:
 *   'skip'     — if next_fire_at is stale (older than 5 min or one interval), drop the fire.
 *   'run_once' — fire exactly one make-up run even if many were missed.
 */
export class CronScheduler {
  private readonly crons = new Map<string, CronMeta>();

  constructor(
    private readonly db: AutomationDb,
    private readonly logger: Logger,
    private readonly fire: (automationId: string, triggerId: string, scheduledFor: string) => void,
  ) {}

  /** Registers or refreshes a schedule row. Computes the first next_fire_at from now. */
  arm(automationId: string, triggerId: string, cron: string, onMissed: OnMissed, now: number): void {
    const next = this.nextAfter(cron, now);
    this.db
      .prepare(`INSERT OR REPLACE INTO trigger_state (automation_id, trigger_id, next_fire_at) VALUES (?, ?, ?)`)
      .run(automationId, triggerId, next);
    this.crons.set(this.key(automationId, triggerId), { cron, onMissed });
  }

  /** Removes all trigger rows and in-memory state for an automation. */
  disarm(automationId: string): void {
    this.db.prepare(`DELETE FROM trigger_state WHERE automation_id = ?`).run(automationId);
    for (const k of [...this.crons.keys()]) {
      if (k.startsWith(`${automationId}:`)) {
        this.crons.delete(k);
      }
    }
  }

  /**
   * Processes all due triggers. Call this on a fixed interval (e.g. every 30s).
   *
   * For each row where next_fire_at <= now:
   *   1. Advance next_fire_at to the next future occurrence.
   *   2. Compute how stale the missed fire was (now - old next_fire_at).
   *   3. If stale AND on_missed === 'skip': log and skip.
   *   4. Otherwise: fire exactly once (covers both timely and run_once make-up).
   */
  sweep(now: number): void {
    const due = this.db
      .prepare(`SELECT automation_id, trigger_id, next_fire_at FROM trigger_state WHERE next_fire_at <= ?`)
      .all(now) as TriggerStateRow[];

    for (const row of due) {
      const meta = this.crons.get(this.key(row.automation_id, row.trigger_id));
      if (!meta) {
        // Stale DB row with no in-memory registration — clean it up.
        this.db
          .prepare(`DELETE FROM trigger_state WHERE automation_id = ? AND trigger_id = ?`)
          .run(row.automation_id, row.trigger_id);
        continue;
      }

      this.advanceAndFire(row, meta, now);
    }
  }

  private advanceAndFire(row: TriggerStateRow, meta: CronMeta, now: number): void {
    const next = this.nextAfter(meta.cron, now);
    this.db
      .prepare(`UPDATE trigger_state SET next_fire_at = ? WHERE automation_id = ? AND trigger_id = ?`)
      .run(next, row.automation_id, row.trigger_id);

    const missedMs = now - row.next_fire_at;
    const oneIntervalMs = next - now;
    const isStale = missedMs > Math.min(oneIntervalMs, 5 * 60_000);

    if (isStale && meta.onMissed === 'skip') {
      this.logger.info({ automationId: row.automation_id, missedMs }, 'cron fire skipped (on_missed: skip)');
      return;
    }

    try {
      this.fire(row.automation_id, row.trigger_id, toLocalIso(row.next_fire_at));
    } catch (err) {
      this.logger.error({ err, automationId: row.automation_id }, 'cron fire callback failed');
    }
  }

  private nextAfter(cron: string, after: number): number {
    // No `tz` option — cron-parser evaluates fields in local system time,
    // matching contract §7 ("all schedules run in local time").
    return CronExpressionParser.parse(cron, { currentDate: new Date(after) })
      .next()
      .getTime();
  }

  private key(automationId: string, triggerId: string): string {
    return `${automationId}:${triggerId}`;
  }
}

/** Formats an epoch ms timestamp as a naive local `YYYY-MM-DDTHH:mm:ss` string (no timezone suffix). */
function toLocalIso(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
