// packages/core/src/__tests__/automations/scheduler.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { AutomationDefinition } from '@qlan-ro/mainframe-types';
import { openAutomationDb, type AutomationDb } from '../../automations/db.js';
import { RunStore } from '../../automations/store/run-store.js';
import { CronScheduler } from '../../automations/triggers/scheduler.js';

function seedAutomation(db: AutomationDb, id: string): void {
  db.prepare(
    `INSERT INTO automations (id, name, scope, enabled, definition, created_at, updated_at)
     VALUES (?, 'A', 'global', 1, '{}', 0, 0)`,
  ).run(id);
}

const DEFINITION: AutomationDefinition = {
  triggers: [{ id: 'trigger-1', kind: 'schedule', schedule: { type: 'daily', at: '08:00' }, onMissed: 'skip' }],
  steps: [{ id: 'notify-1', kind: 'notify', message: ['hi'] }],
};

describe('CronScheduler', () => {
  let dir: string;
  let db: AutomationDb;
  let originalTz: string | undefined;

  beforeEach(() => {
    originalTz = process.env.TZ;
    dir = mkdtempSync(join(tmpdir(), 'automations-scheduler-'));
    db = openAutomationDb(join(dir, 'automations.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    process.env.TZ = originalTz;
  });

  const fired: Array<{ automationId: string; triggerId: string; scheduledFor: string }> = [];

  function makeScheduler() {
    fired.length = 0;
    return new CronScheduler(db, pino({ level: 'silent' }), (automationId, triggerId, scheduledFor) => {
      fired.push({ automationId, triggerId, scheduledFor });
    });
  }

  it('arms a schedule and fires when due, not before', () => {
    const sched = makeScheduler();
    const base = new Date('2026-06-12T07:59:30').getTime();
    sched.arm('auto-1', 'trigger-1', '0 8 * * *', 'skip', base);
    sched.sweep(base); // not due yet
    expect(fired).toEqual([]);
    sched.sweep(new Date('2026-06-12T08:00:10').getTime());
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ automationId: 'auto-1', triggerId: 'trigger-1' });
    // next fire re-armed for tomorrow — sweeping again should not re-fire
    sched.sweep(new Date('2026-06-12T08:00:40').getTime());
    expect(fired).toHaveLength(1);
  });

  it('computes scheduledFor in local wall-clock time, not UTC', () => {
    process.env.TZ = 'America/New_York';
    const sched = makeScheduler();
    // Local (ET) time — with the old v1 UTC-pinned parser this cron would
    // next fire at 08:00 UTC (04:00 ET) instead of 08:00 local.
    const base = new Date('2026-06-12T07:00:00').getTime();
    sched.arm('auto-1', 'trigger-1', '0 8 * * *', 'skip', base);
    sched.sweep(new Date('2026-06-12T08:00:01').getTime());
    expect(fired).toEqual([{ automationId: 'auto-1', triggerId: 'trigger-1', scheduledFor: '2026-06-12T08:00:00' }]);
  });

  it('disarm removes trigger_state rows and stops future fires', () => {
    const sched = makeScheduler();
    const base = new Date('2026-06-12T07:59:30').getTime();
    sched.arm('auto-1', 'trigger-1', '0 8 * * *', 'skip', base);
    sched.disarm('auto-1');
    sched.sweep(new Date('2026-06-12T08:00:10').getTime());
    expect(fired).toEqual([]);
    const row = db.prepare(`SELECT * FROM trigger_state WHERE automation_id = ?`).get('auto-1');
    expect(row).toBeUndefined();
  });

  it('on_missed: skip drops missed fires after a long sleep', () => {
    const sched = makeScheduler();
    const base = new Date('2026-06-12T07:00:00').getTime();
    sched.arm('auto-1', 'trigger-1', '0 8 * * *', 'skip', base);
    // Laptop slept 3 days:
    sched.sweep(new Date('2026-06-15T12:00:00').getTime());
    expect(fired).toEqual([]); // skipped — no backlog fires
  });

  it('on_missed: run_once fires exactly one make-up run after a long sleep', () => {
    const sched = makeScheduler();
    const base = new Date('2026-06-12T07:00:00').getTime();
    sched.arm('auto-1', 'trigger-1', '0 8 * * *', 'run_once', base);
    sched.sweep(new Date('2026-06-15T12:00:00').getTime());
    expect(fired).toHaveLength(1); // exactly one, not three
  });

  it('a duplicate fire for the same scheduledFor loses the insert race and creates exactly one run', () => {
    seedAutomation(db, 'auto-1');
    const runStore = new RunStore(db);
    const sched = new CronScheduler(db, pino({ level: 'silent' }), (automationId, triggerId, scheduledFor) => {
      runStore.createRun(
        automationId,
        DEFINITION,
        { kind: 'schedule', triggerId, scheduledFor },
        `${triggerId}|${scheduledFor}`,
      );
    });
    const base = new Date('2026-06-12T07:59:30').getTime();
    sched.arm('auto-1', 'trigger-1', '0 8 * * *', 'skip', base);
    const armedRow = db
      .prepare(`SELECT next_fire_at FROM trigger_state WHERE automation_id = ? AND trigger_id = ?`)
      .get('auto-1', 'trigger-1') as { next_fire_at: number };
    const dueAt = new Date('2026-06-12T08:00:10').getTime();
    sched.sweep(dueAt);
    expect(runStore.listRuns('auto-1')).toHaveLength(1);

    // Simulate a second scheduler/daemon racing on the same due row: it read
    // next_fire_at before this sweep advanced it, so it recomputes the exact
    // same scheduledFor and tries to fire again.
    db.prepare(`UPDATE trigger_state SET next_fire_at = ? WHERE automation_id = ? AND trigger_id = ?`).run(
      armedRow.next_fire_at,
      'auto-1',
      'trigger-1',
    );
    sched.sweep(dueAt + 1);

    expect(runStore.listRuns('auto-1')).toHaveLength(1);
  });
});
