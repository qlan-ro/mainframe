// packages/core/src/__tests__/automations/run-store.test.ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AutomationDefinition } from '@qlan-ro/mainframe-types';
import { openAutomationDb, type AutomationDb } from '../../automations/db.js';
import { RunStore } from '../../automations/store/run-store.js';
import type { AutomationRunTriggerContext } from '../../automations/store/types.js';

const DEFINITION: AutomationDefinition = {
  triggers: [{ id: 'trigger-1', kind: 'schedule', schedule: { type: 'daily', at: '09:00' }, onMissed: 'skip' }],
  steps: [{ id: 'notify-1', kind: 'notify', message: ['hi'] }],
};

const MANUAL_TRIGGER: AutomationRunTriggerContext = { kind: 'manual' };
const SCHEDULE_TRIGGER: AutomationRunTriggerContext = {
  kind: 'schedule',
  triggerId: 'trigger-1',
  scheduledFor: '2026-07-12T09:00:00',
};

function seedAutomation(db: AutomationDb, id: string): void {
  db.prepare(
    `INSERT INTO automations (id, name, scope, enabled, definition, created_at, updated_at)
     VALUES (?, 'A', 'global', 1, '{}', 0, 0)`,
  ).run(id);
}

describe('RunStore', () => {
  let dir: string;
  let db: AutomationDb;
  let store: RunStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-runstore-'));
    db = openAutomationDb(join(dir, 'automations.db'));
    seedAutomation(db, 'auto-1');
    store = new RunStore(db);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('createRun freezes both the definition and trigger snapshots inside the checkpoint', () => {
    const run = store.createRun('auto-1', DEFINITION, SCHEDULE_TRIGGER, 'trigger-1|2026-07-12T09:00:00');
    expect(run.automationId).toBe('auto-1');
    expect(run.status).toBe('running');
    expect(run.checkpoint.definition).toEqual(DEFINITION);
    expect(run.checkpoint.trigger).toEqual(SCHEDULE_TRIGGER);
    expect(run.checkpoint.steps).toEqual({});
    expect(run.checkpoint.wakeAt).toBeNull();
    expect(run.checkpoint.error).toBeNull();
    expect(run.finishedAt).toBeNull();
  });

  it('manual runs use a null dedup key and never collide', () => {
    const r1 = store.createRun('auto-1', DEFINITION, MANUAL_TRIGGER, null);
    const r2 = store.createRun('auto-1', DEFINITION, MANUAL_TRIGGER, null);
    expect(r1.id).not.toBe(r2.id);
  });

  it('a duplicate scheduled dedup key loses the insert race', () => {
    store.createRun('auto-1', DEFINITION, SCHEDULE_TRIGGER, 'trigger-1|2026-07-12T09:00:00');
    expect(() => store.createRun('auto-1', DEFINITION, SCHEDULE_TRIGGER, 'trigger-1|2026-07-12T09:00:00')).toThrow();
  });

  it('getRun round-trips a created run; returns null for a missing id', () => {
    const created = store.createRun('auto-1', DEFINITION, MANUAL_TRIGGER, null);
    expect(store.getRun(created.id)).toEqual(created);
    expect(store.getRun('missing')).toBeNull();
  });

  it('listRuns orders newest-first and respects the limit', () => {
    const r1 = store.createRun('auto-1', DEFINITION, MANUAL_TRIGGER, null);
    const r2 = store.createRun('auto-1', DEFINITION, MANUAL_TRIGGER, null);
    const r3 = store.createRun('auto-1', DEFINITION, MANUAL_TRIGGER, null);
    const ids = store.listRuns('auto-1', 2).map((r) => r.id);
    expect(ids).toEqual([r3.id, r2.id]);
    expect(ids).not.toContain(r1.id);
  });

  it('loadResumable returns only running|waiting runs', () => {
    const running = store.createRun('auto-1', DEFINITION, MANUAL_TRIGGER, null);
    const toFinish = store.createRun('auto-1', DEFINITION, MANUAL_TRIGGER, null);
    store.finalizeRun(toFinish.id, 'succeeded', null);
    const waiting = store.createRun('auto-1', DEFINITION, MANUAL_TRIGGER, null);
    store.patchCheckpoint(waiting.id, (checkpoint) => ({ ...checkpoint, wakeAt: Date.now() + 60_000 }));

    const resumable = store
      .loadResumable()
      .map((r) => r.id)
      .sort();
    expect(resumable).toEqual([running.id, waiting.id].sort());
  });

  it('patchCheckpoint read-modify-writes the checkpoint and derives status from wakeAt', () => {
    const run = store.createRun('auto-1', DEFINITION, MANUAL_TRIGGER, null);

    const parked = store.patchCheckpoint(run.id, (checkpoint) => ({
      ...checkpoint,
      wakeAt: 12345,
      steps: {
        'notify-1': {
          stepId: 'notify-1',
          kind: 'notify',
          status: 'running',
          outputs: null,
          error: null,
          startedAt: 1,
          finishedAt: null,
        },
      },
    }));
    expect(parked.status).toBe('waiting');
    expect(parked.checkpoint.wakeAt).toBe(12345);
    expect(parked.checkpoint.steps['notify-1']?.status).toBe('running');

    const resumed = store.patchCheckpoint(run.id, (checkpoint) => ({ ...checkpoint, wakeAt: null }));
    expect(resumed.status).toBe('running');
  });

  it('finalizeRun sets a terminal status, finished_at, clears wakeAt, and records the error', () => {
    const run = store.createRun('auto-1', DEFINITION, MANUAL_TRIGGER, null);
    store.patchCheckpoint(run.id, (checkpoint) => ({ ...checkpoint, wakeAt: 999 }));

    const failed = store.finalizeRun(run.id, 'failed', 'step "notify-1" blew up');
    expect(failed.status).toBe('failed');
    expect(failed.finishedAt).not.toBeNull();
    expect(failed.checkpoint.wakeAt).toBeNull();
    expect(failed.checkpoint.error).toBe('step "notify-1" blew up');
  });

  it('rejects a per-step output payload over the 4MB cap and leaves the checkpoint unchanged', () => {
    const run = store.createRun('auto-1', DEFINITION, MANUAL_TRIGGER, null);
    const huge = 'x'.repeat(5 * 1024 * 1024);

    expect(() =>
      store.patchCheckpoint(run.id, (checkpoint) => ({
        ...checkpoint,
        steps: {
          'notify-1': {
            stepId: 'notify-1',
            kind: 'notify',
            status: 'succeeded',
            outputs: { result: huge },
            error: null,
            startedAt: 1,
            finishedAt: 2,
          },
        },
      })),
    ).toThrow(/write large data to a file/);

    // Rejected write must not have landed (transactional read-modify-write).
    expect(store.getRun(run.id)?.checkpoint.steps).toEqual({});
  });
});
