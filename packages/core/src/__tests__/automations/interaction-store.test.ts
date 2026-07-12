// packages/core/src/__tests__/automations/interaction-store.test.ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AutomationDefinition, AutomationFormField } from '@qlan-ro/mainframe-types';
import { openAutomationDb, type AutomationDb } from '../../automations/db.js';
import { RunStore } from '../../automations/store/run-store.js';
import { InteractionStore } from '../../automations/store/interaction-store.js';

const DEFINITION: AutomationDefinition = {
  triggers: [],
  steps: [{ id: 'ask-health', kind: 'ask_me', title: 'Health check-in', fields: [] }],
};

const FIELDS: AutomationFormField[] = [{ key: 'mood', type: 'choice', options: ['good', 'bad'], required: true }];

describe('InteractionStore', () => {
  let dir: string;
  let db: AutomationDb;
  let runStore: RunStore;
  let store: InteractionStore;
  let runId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-interactionstore-'));
    db = openAutomationDb(join(dir, 'automations.db'));
    db.prepare(
      `INSERT INTO automations (id, name, scope, enabled, definition, created_at, updated_at)
       VALUES ('auto-1', 'A', 'global', 1, '{}', 0, 0)`,
    ).run();
    runStore = new RunStore(db);
    store = new InteractionStore(db, runStore);
    runId = runStore.createRun('auto-1', DEFINITION, { kind: 'manual' }, null).id;
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('create/get round-trips a pending interaction', () => {
    const created = store.create({ runId, stepRef: 'ask-health', title: 'Health check-in', fields: FIELDS });
    expect(created.status).toBe('pending');
    expect(created.resolvedAt).toBeNull();
    expect(store.get(created.id)).toEqual(created);
  });

  it('findPendingForStep finds only a pending interaction for that exact run+stepRef', () => {
    store.create({ runId, stepRef: 'ask-health', title: 'Health check-in', fields: FIELDS });
    expect(store.findPendingForStep(runId, 'ask-health')).not.toBeNull();
    expect(store.findPendingForStep(runId, 'other-step')).toBeNull();
    expect(store.findPendingForStep('other-run', 'ask-health')).toBeNull();
  });

  it('listPending lists only pending interactions', () => {
    const a = store.create({ runId, stepRef: 'ask-health', title: 'A', fields: FIELDS });
    store.claim(a.id, 'cancelled');
    const b = store.create({ runId, stepRef: 'ask-health-2', title: 'B', fields: FIELDS });
    expect(store.listPending().map((i) => i.id)).toEqual([b.id]);
  });

  it('claim atomically transitions pending to the target status, returning false if already claimed', () => {
    const interaction = store.create({ runId, stepRef: 'ask-health', title: 'A', fields: FIELDS });
    expect(store.claim(interaction.id, 'answered')).toBe(true);
    expect(store.get(interaction.id)?.status).toBe('answered');
    expect(store.get(interaction.id)?.resolvedAt).not.toBeNull();
    expect(store.claim(interaction.id, 'answered')).toBe(false);
  });

  it('resolveInOneTx claims the interaction and writes into the checkpoint atomically', () => {
    const interaction = store.create({ runId, stepRef: 'ask-health', title: 'A', fields: FIELDS });
    const answers = { mood: 'good' };

    const resolved = store.resolveInOneTx(interaction.id, answers, runId, (checkpoint, answersArg) => ({
      ...checkpoint,
      steps: {
        ...checkpoint.steps,
        'ask-health': {
          stepId: 'ask-health',
          kind: 'ask_me',
          status: 'succeeded',
          outputs: answersArg,
          error: null,
          startedAt: 1,
          finishedAt: 2,
        },
      },
    }));

    expect(resolved.status).toBe('answered');
    expect(runStore.getRun(runId)?.checkpoint.steps['ask-health']?.outputs).toEqual(answers);
  });

  it('resolveInOneTx rolls back the claim when the checkpoint patch throws', () => {
    const interaction = store.create({ runId, stepRef: 'ask-health', title: 'A', fields: FIELDS });

    expect(() =>
      store.resolveInOneTx(interaction.id, { mood: 'good' }, runId, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(store.get(interaction.id)?.status).toBe('pending');
  });

  it('resolveInOneTx rejects an already-answered interaction without touching the checkpoint', () => {
    const interaction = store.create({ runId, stepRef: 'ask-health', title: 'A', fields: FIELDS });
    store.claim(interaction.id, 'answered');

    expect(() => store.resolveInOneTx(interaction.id, { mood: 'good' }, runId, (checkpoint) => checkpoint)).toThrow();
  });

  it('cancelPendingForRun bulk-claims all pending interactions for a run to cancelled', () => {
    const a = store.create({ runId, stepRef: 'ask-health', title: 'A', fields: FIELDS });
    const b = store.create({ runId, stepRef: 'ask-health-2', title: 'B', fields: FIELDS });
    const otherRunId = runStore.createRun('auto-1', DEFINITION, { kind: 'manual' }, null).id;
    const c = store.create({ runId: otherRunId, stepRef: 'ask-health', title: 'C', fields: FIELDS });

    const count = store.cancelPendingForRun(runId);

    expect(count).toBe(2);
    expect(store.get(a.id)?.status).toBe('cancelled');
    expect(store.get(b.id)?.status).toBe('cancelled');
    expect(store.get(c.id)?.status).toBe('pending');
  });
});
