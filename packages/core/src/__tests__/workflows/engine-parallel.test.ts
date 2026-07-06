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

describe('parallel blocks', () => {
  let dir: string;
  let db: WorkflowDb;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfpar-'));
    db = openWorkflowDb(join(dir, 'w.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs branches with isolated scopes and keyed output', async () => {
    const engine = makeEngine(db);
    const def = {
      version: 1 as const,
      name: 'par',
      steps: [
        { id: 'seed', set: { base: 10 } },
        {
          id: 'fan',
          parallel: {
            x: [{ id: 'same', set: { v: '${ seed.output.base + 1 }' } }],
            y: [{ id: 'same', set: { v: '${ seed.output.base + 2 }' } }],
          },
        },
        { id: 'join', set: { sum: '${ fan.output.x.v + fan.output.y.v }' } },
      ],
    };
    const run = engine.startRun({
      workflowId: 'g:par',
      definition: def,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    await engine.advance(run.id);
    expect(engine.store.getRun(run.id)?.status).toBe('succeeded');
    expect(engine.store.latestStepResults(run.id).get('steps.2')?.output).toEqual({ sum: 23 });
    // duplicate ids across branches are fine — distinct paths:
    expect(engine.store.latestStepResults(run.id).get('steps.1.parallel.x.0')?.status).toBe('succeeded');
    expect(engine.store.latestStepResults(run.id).get('steps.1.parallel.y.0')?.status).toBe('succeeded');
  });
});
