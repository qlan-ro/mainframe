import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { openWorkflowDb, type WorkflowDb } from '../../workflows/db.js';
import { RunStore } from '../../workflows/store/run-store.js';
import { WorkflowEngine } from '../../workflows/engine/engine.js';
import { ConnectorRegistry } from '../../workflows/connectors/registry.js';
import { makeCallExecutor, CallCoordinator } from '../../workflows/engine/executors/call.js';

const CHILD = {
  version: 1 as const,
  name: 'child',
  inputs: { x: { type: 'number' } },
  steps: [{ id: 'double', set: { v: '${ inputs.x * 2 }' } }],
  outputs: { doubled: '${ double.output.v }' },
};
const PARENT = {
  version: 1 as const,
  name: 'parent',
  steps: [
    { id: 'sub', call: 'child', with: { x: 21 } },
    { id: 'use', set: { got: '${ sub.output.doubled }' } },
  ],
};

function setup(db: WorkflowDb) {
  const store = new RunStore(db);
  const coordinator = new CallCoordinator(
    store,
    (name) => (name === 'child' ? { id: 'g:child', definition: CHILD } : null),
    pino({ level: 'silent' }),
  );
  const engine = new WorkflowEngine({
    store,
    connectors: new ConnectorRegistry(),
    logger: pino({ level: 'silent' }),
    emitEvent: () => {},
    executors: { call: makeCallExecutor(coordinator) },
    onRunFinalized: (id) => coordinator.onRunFinalized(id),
  });
  coordinator.bindEngine(engine);
  return { engine, store, coordinator };
}

describe('call steps', () => {
  let dir: string;
  let db: WorkflowDb;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfc-'));
    db = openWorkflowDb(join(dir, 'w.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs child to completion and binds declared outputs in the parent', async () => {
    const { engine } = setup(db);
    const run = engine.startRun({
      workflowId: 'g:parent',
      definition: PARENT,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    await engine.advance(run.id);
    const done = engine.store.getRun(run.id);
    expect(done?.status).toBe('succeeded');
    expect(engine.store.latestStepResults(run.id).get('steps.1')?.output).toEqual({ got: 42 });
  });

  it('fails the parent step when the child workflow is unknown', async () => {
    const { engine } = setup(db);
    const def = {
      version: 1 as const,
      name: 'p2',
      steps: [{ id: 'sub', call: 'ghost', with: {} }],
    };
    const run = engine.startRun({
      workflowId: 'g:p2',
      definition: def,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    await engine.advance(run.id);
    expect(engine.store.getRun(run.id)?.status).toBe('failed');
    expect(engine.store.getRun(run.id)?.error).toMatch(/unknown workflow 'ghost'/);
  });

  it('enforces the depth cap', async () => {
    const { engine, store } = setup(db);
    // Fake an ancestor chain 3 deep: r1 <- r2 <- r3 <- deep
    const r1 = store.createRun({
      workflowId: 'a',
      definition: PARENT,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    const r2 = store.createRun({
      workflowId: 'b',
      definition: PARENT,
      triggerKind: 'call',
      inputs: {},
      triggerPayload: null,
      parentRunId: r1.id,
      parentStepPath: 'steps.0',
    });
    const r3 = store.createRun({
      workflowId: 'c',
      definition: PARENT,
      triggerKind: 'call',
      inputs: {},
      triggerPayload: null,
      parentRunId: r2.id,
      parentStepPath: 'steps.0',
    });
    const deep = store.createRun({
      workflowId: 'g:parent',
      definition: PARENT,
      triggerKind: 'call',
      inputs: {},
      triggerPayload: null,
      parentRunId: r3.id,
      parentStepPath: 'steps.0',
    });
    await engine.advance(deep.id);
    expect(store.getRun(deep.id)?.status).toBe('failed');
    expect(store.getRun(deep.id)?.error).toMatch(/depth/);
  });
});
