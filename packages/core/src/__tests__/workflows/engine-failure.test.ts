import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import pino from 'pino';
import { openWorkflowDb, type WorkflowDb } from '../../workflows/db.js';
import { RunStore } from '../../workflows/store/run-store.js';
import { WorkflowEngine } from '../../workflows/engine/engine.js';
import { ConnectorRegistry } from '../../workflows/connectors/registry.js';
import type { Connector } from '../../workflows/connectors/types.js';

let failuresLeft = 0;
let sideEffects = 0;
const flaky: Connector = {
  id: 'flaky',
  title: 'Flaky',
  auth: { kind: 'none' },
  actions: {
    idem: {
      title: 'Idem',
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      idempotent: true,
      async run() {
        if (failuresLeft-- > 0) throw new Error('transient');
        return { ok: true };
      },
    },
    effect: {
      title: 'Effect',
      input: z.object({}),
      output: z.object({ n: z.number() }),
      idempotent: false,
      async run() {
        sideEffects += 1;
        return { n: sideEffects };
      },
    },
  },
};

function makeEngine(db: WorkflowDb) {
  const registry = new ConnectorRegistry();
  registry.register(flaky);
  return new WorkflowEngine({
    store: new RunStore(db),
    connectors: registry,
    logger: pino({ level: 'silent' }),
    emitEvent: () => {},
    executors: {},
  });
}

describe('failure handling', () => {
  let dir: string;
  let db: WorkflowDb;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wff-'));
    db = openWorkflowDb(join(dir, 'w.db'));
    failuresLeft = 0;
    sideEffects = 0;
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('retries per policy then succeeds', async () => {
    failuresLeft = 2;
    const engine = makeEngine(db);
    const def = {
      version: 1 as const,
      name: 'r',
      steps: [{ id: 'x', connector: 'flaky.idem', with: {}, retry: { attempts: 3, initialDelayMs: 1 } }],
    };
    const run = engine.startRun({
      workflowId: 'g:r',
      definition: def,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    await engine.advance(run.id);
    expect(engine.store.getRun(run.id)?.status).toBe('succeeded');
    expect(engine.store.listStepRuns(run.id)).toHaveLength(3); // 2 failed + 1 succeeded
  });

  it('on_failure: continue binds null and proceeds', async () => {
    failuresLeft = 99;
    const engine = makeEngine(db);
    const def = {
      version: 1 as const,
      name: 'c',
      steps: [
        { id: 'x', connector: 'flaky.idem', with: {}, on_failure: 'continue' as const },
        { id: 'y', set: { sawNull: '${ x.output = null }' } },
      ],
    };
    const run = engine.startRun({
      workflowId: 'g:c',
      definition: def,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    await engine.advance(run.id);
    const done = engine.store.getRun(run.id);
    expect(done?.status).toBe('succeeded');
    expect(engine.store.latestStepResults(run.id).get('steps.1')?.output).toEqual({ sawNull: true });
  });

  it('marks a non-idempotent step ambiguous on resume instead of re-running it', async () => {
    const engine = makeEngine(db);
    const def = { version: 1 as const, name: 'amb', steps: [{ id: 'fx', connector: 'flaky.effect', with: {} }] };
    const run = engine.startRun({
      workflowId: 'g:amb',
      definition: def,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    // Simulate a crash AFTER the side effect but BEFORE the success commit:
    // hand-write a 'running' step row, as the engine does before executing non-idempotent actions.
    engine.store.commitStep(run.id, {
      stepPath: 'steps.0',
      stepId: 'fx',
      kind: 'connector',
      attempt: 1,
      status: 'running',
      input: null,
      output: null,
      scratch: null,
      error: null,
    });
    await engine.advance(run.id);
    const done = engine.store.getRun(run.id);
    expect(done?.status).toBe('failed');
    expect(done?.error).toMatch(/ambiguous/);
    expect(engine.store.latestStepResults(run.id).get('steps.0')?.status).toBe('ambiguous');
    expect(sideEffects).toBe(0); // critically: NOT re-executed
  });
});
