import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkflowDb, type WorkflowDb } from '../../workflows/db.js';
import { RunStore } from '../../workflows/store/run-store.js';

describe('RunStore', () => {
  let dir: string;
  let db: WorkflowDb;
  let store: RunStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfstore-'));
    db = openWorkflowDb(join(dir, 'workflows.db'));
    store = new RunStore(db);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const DEF = { version: 1 as const, name: 'x', steps: [{ id: 'a', set: { v: 1 } }] };

  it('creates a run and reads it back', () => {
    const run = store.createRun({
      workflowId: 'global:x',
      definition: DEF,
      triggerKind: 'manual',
      inputs: { a: 1 },
      triggerPayload: null,
    });
    const loaded = store.getRun(run.id);
    expect(loaded?.status).toBe('running');
    expect(loaded?.inputs).toEqual({ a: 1 });
    expect(loaded?.definition.name).toBe('x');
  });

  it('commitStep persists output value and step row in one transaction', () => {
    const run = store.createRun({
      workflowId: 'g:x',
      definition: DEF,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    store.commitStep(run.id, {
      stepPath: 'steps.0',
      stepId: 'a',
      kind: 'set',
      attempt: 1,
      status: 'succeeded',
      input: { v: 1 },
      output: { v: 1 },
      error: null,
      scratch: null,
    });
    const steps = store.listStepRuns(run.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.output).toEqual({ v: 1 });
  });

  it('latestStepResults returns newest attempt per step_path', () => {
    const run = store.createRun({
      workflowId: 'g:x',
      definition: DEF,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    store.commitStep(run.id, {
      stepPath: 'steps.0',
      stepId: 'a',
      kind: 'set',
      attempt: 1,
      status: 'failed',
      input: null,
      output: null,
      error: 'boom',
      scratch: null,
    });
    store.commitStep(run.id, {
      stepPath: 'steps.0',
      stepId: 'a',
      kind: 'set',
      attempt: 2,
      status: 'succeeded',
      input: null,
      output: { v: 2 },
      error: null,
      scratch: null,
    });
    const latest = store.latestStepResults(run.id);
    expect(latest.get('steps.0')?.status).toBe('succeeded');
    expect(latest.get('steps.0')?.output).toEqual({ v: 2 });
  });

  it('rejects oversized outputs', () => {
    const run = store.createRun({
      workflowId: 'g:x',
      definition: DEF,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    const big = 'x'.repeat(4 * 1024 * 1024 + 1);
    expect(() =>
      store.commitStep(run.id, {
        stepPath: 'steps.0',
        stepId: 'a',
        kind: 'set',
        attempt: 1,
        status: 'succeeded',
        input: null,
        output: big,
        error: null,
        scratch: null,
      }),
    ).toThrow(/output too large/);
  });

  it('finalize sets terminal status and outputs', () => {
    const run = store.createRun({
      workflowId: 'g:x',
      definition: DEF,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    store.finalizeRun(run.id, 'succeeded', { done: true }, null);
    const loaded = store.getRun(run.id);
    expect(loaded?.status).toBe('succeeded');
    expect(loaded?.outputs).toEqual({ done: true });
    expect(loaded?.finishedAt).toBeTruthy();
  });

  it('park and wake update status and wake_at', () => {
    const run = store.createRun({
      workflowId: 'g:x',
      definition: DEF,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    store.parkRun(run.id, Date.now() + 60_000);
    expect(store.getRun(run.id)?.status).toBe('waiting');
    expect(store.listDueRuns(Date.now() + 120_000)).toHaveLength(1);
    store.markRunning(run.id);
    expect(store.getRun(run.id)?.status).toBe('running');
  });
});
