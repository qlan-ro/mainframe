import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { openWorkflowDb, type WorkflowDb } from '../../workflows/db.js';
import { RunStore } from '../../workflows/store/run-store.js';
import { WorkflowEngine } from '../../workflows/engine/engine.js';
import { ConnectorRegistry } from '../../workflows/connectors/registry.js';

function makeEngine(db: WorkflowDb) {
  return new WorkflowEngine({
    store: new RunStore(db),
    connectors: new ConnectorRegistry(),
    logger: pino({ level: 'silent' }),
    emitEvent: () => {},
    executors: {},
  });
}

describe('foreach blocks', () => {
  let dir: string;
  let db: WorkflowDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wffe-'));
    db = openWorkflowDb(join(dir, 'w.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('maps items to an output array with item/index in scope', async () => {
    const engine = makeEngine(db);
    const def = {
      version: 1 as const,
      name: 'fe',
      steps: [
        {
          id: 'loop',
          foreach: '${ inputs.items }',
          as: 'n',
          steps: [{ id: 'calc', set: { v: '${ n * 10 + index }' } }],
          output: '${ calc.output.v }',
        },
        { id: 'sum', set: { total: '${ $sum(loop.output) }' } },
      ],
    };
    const run = engine.startRun({
      workflowId: 'g:fe',
      definition: def,
      triggerKind: 'manual',
      inputs: { items: [1, 2, 3] },
      triggerPayload: null,
    });
    await engine.advance(run.id);

    expect(engine.store.getRun(run.id)?.status).toBe('succeeded');
    expect(engine.store.latestStepResults(run.id).get('steps.0')?.output).toEqual([10, 21, 32]);
    expect(engine.store.latestStepResults(run.id).get('steps.1')?.output).toEqual({ total: 63 });
  });

  it('fails cleanly when foreach does not evaluate to an array', async () => {
    const engine = makeEngine(db);
    const def = {
      version: 1 as const,
      name: 'bad',
      steps: [{ id: 'loop', foreach: '${ inputs.x }', steps: [{ id: 's', set: { v: 1 } }] }],
    };
    const run = engine.startRun({
      workflowId: 'g:bad',
      definition: def,
      triggerKind: 'manual',
      inputs: { x: 'not-an-array' },
      triggerPayload: null,
    });
    await engine.advance(run.id);

    expect(engine.store.getRun(run.id)?.status).toBe('failed');
    expect(engine.store.getRun(run.id)?.error).toMatch(/array/);
  });

  it('records per-iteration labels in scratch for object items with number property', async () => {
    const engine = makeEngine(db);
    const def = {
      version: 1 as const,
      name: 'labels',
      steps: [
        {
          id: 'loop',
          foreach: '${ inputs.issues }',
          steps: [{ id: 'noop', set: { v: '${ item.number }' } }],
        },
      ],
    };
    const run = engine.startRun({
      workflowId: 'g:labels',
      definition: def,
      triggerKind: 'manual',
      inputs: { issues: [{ number: 308 }, { number: 312 }] },
      triggerPayload: null,
    });
    await engine.advance(run.id);

    expect(engine.store.getRun(run.id)?.status).toBe('succeeded');
    const loopRow = engine.store.latestStepResults(run.id).get('steps.0');
    const scratch = loopRow?.scratch as { iterations?: Array<{ index: number; label: string }> } | null;
    expect(scratch?.iterations).toEqual([
      { index: 0, label: '308' },
      { index: 1, label: '312' },
    ]);
  });
});
