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

const calls: string[] = [];
const probe: Connector = {
  id: 'probe',
  title: 'Probe',
  auth: { kind: 'none' },
  actions: {
    hit: {
      title: 'Hit',
      input: z.object({ tag: z.string() }),
      output: z.object({ tag: z.string() }),
      idempotent: true,
      async run(_ctx, input) {
        const tag = (input as { tag: string }).tag;
        calls.push(tag);
        return { tag };
      },
    },
    boom: {
      title: 'Boom',
      input: z.object({}),
      output: z.object({}),
      idempotent: true,
      async run() {
        throw new Error('kaboom');
      },
    },
  },
};

function makeEngine(db: WorkflowDb) {
  const registry = new ConnectorRegistry();
  registry.register(probe);
  return new WorkflowEngine({
    store: new RunStore(db),
    connectors: registry,
    logger: pino({ level: 'silent' }),
    emitEvent: () => {},
    executors: {},
  });
}

describe('WorkflowEngine core', () => {
  let dir: string;
  let db: WorkflowDb;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfeng-'));
    db = openWorkflowDb(join(dir, 'w.db'));
    calls.length = 0;
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const DEF = {
    version: 1 as const,
    name: 'seq',
    steps: [
      { id: 'a', set: { doubled: '${ inputs.n * 2 }' } },
      { id: 'b', connector: 'probe.hit', with: { tag: 'tag-${ a.output.doubled }' } },
    ],
    outputs: { result: '${ b.output.tag }' },
  };

  it('runs a sequence, binds outputs, evaluates workflow outputs', async () => {
    const engine = makeEngine(db);
    const run = engine.startRun({
      workflowId: 'g:seq',
      definition: DEF,
      triggerKind: 'manual',
      inputs: { n: 21 },
      triggerPayload: null,
    });
    await engine.advance(run.id);
    const done = engine.store.getRun(run.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.outputs).toEqual({ result: 'tag-42' });
    expect(calls).toEqual(['tag-42']);
  });

  it('replay after restart skips committed steps (no double side effects)', async () => {
    const engine1 = makeEngine(db);
    const run = engine1.startRun({
      workflowId: 'g:seq',
      definition: DEF,
      triggerKind: 'manual',
      inputs: { n: 1 },
      triggerPayload: null,
    });
    await engine1.advance(run.id);
    expect(calls).toEqual(['tag-2']);
    // Simulate restart: new engine over same db, advance of finished run is no-op,
    // and re-advancing a half-done run re-executes only uncommitted steps.
    const engine2 = makeEngine(db);
    await engine2.advance(run.id);
    expect(calls).toEqual(['tag-2']); // not called again
  });

  it('fails the run when a connector throws and no retry/on_failure is set', async () => {
    const engine = makeEngine(db);
    const def = {
      version: 1 as const,
      name: 'f',
      steps: [{ id: 'x', connector: 'probe.boom', with: {} }],
    };
    const run = engine.startRun({
      workflowId: 'g:f',
      definition: def,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    await engine.advance(run.id);
    const done = engine.store.getRun(run.id);
    expect(done?.status).toBe('failed');
    expect(done?.error).toMatch(/kaboom/);
  });

  it('validates inputs against the definition before starting', () => {
    const engine = makeEngine(db);
    const def = { ...DEF, inputs: { n: { type: 'number' } } };
    expect(() =>
      engine.startRun({
        workflowId: 'g:seq',
        definition: def,
        triggerKind: 'manual',
        inputs: {},
        triggerPayload: null,
      }),
    ).toThrow(/required input 'n'/);
  });
});
