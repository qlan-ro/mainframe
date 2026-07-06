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

describe('WorkflowEngine choose block', () => {
  let dir: string;
  let db: WorkflowDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfchoose-'));
    db = openWorkflowDb(join(dir, 'w.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs the taken arm and exports its inner step output; inner step row exists at correct path', async () => {
    const def = {
      version: 1 as const,
      name: 'branch',
      steps: [
        {
          id: 'gate',
          choose: [
            {
              when: '${ inputs.mode = "fast" }',
              steps: [{ id: 'inner', set: { speed: 'quick' } }],
            },
            {
              else: true,
              steps: [{ id: 'slow', set: { speed: 'slow' } }],
            },
          ],
          output: '${ inner.output.speed }',
        },
      ],
    };

    const engine = makeEngine(db);
    const run = engine.startRun({
      workflowId: 'g:branch',
      definition: def,
      triggerKind: 'manual',
      inputs: { mode: 'fast' },
      triggerPayload: null,
    });
    await engine.advance(run.id);

    const done = engine.store.getRun(run.id);
    expect(done?.status).toBe('succeeded');

    // The block's output expression is evaluated and bound as the gate step's output.
    const latest = engine.store.latestStepResults(run.id);
    const gateRow = latest.get('steps.0');
    expect(gateRow?.status).toBe('succeeded');
    expect(gateRow?.output).toBe('quick');
    expect((gateRow?.scratch as { takenArm?: number } | null)?.takenArm).toBe(0);

    // The inner step row must exist at the correct nested path.
    const innerRow = latest.get('steps.0.choose.0.steps.0');
    expect(innerRow?.status).toBe('succeeded');
    expect(innerRow?.output).toEqual({ speed: 'quick' });
  });

  it('exports null and records takenArm -1 when no arm matches and there is no else', async () => {
    const def = {
      version: 1 as const,
      name: 'nomatch',
      steps: [
        {
          id: 'gate',
          choose: [
            {
              when: '${ inputs.x = 99 }',
              steps: [{ id: 'unreachable', set: { v: 1 } }],
            },
          ],
        },
      ],
    };

    const engine = makeEngine(db);
    const run = engine.startRun({
      workflowId: 'g:nomatch',
      definition: def,
      triggerKind: 'manual',
      inputs: { x: 0 },
      triggerPayload: null,
    });
    await engine.advance(run.id);

    const done = engine.store.getRun(run.id);
    expect(done?.status).toBe('succeeded');

    const latest = engine.store.latestStepResults(run.id);
    const gateRow = latest.get('steps.0');
    expect(gateRow?.status).toBe('succeeded');
    expect(gateRow?.output).toBeNull();
    expect((gateRow?.scratch as { takenArm?: number } | null)?.takenArm).toBe(-1);

    // The unreachable inner step must NOT have a row.
    expect(latest.get('steps.0.choose.0.steps.0')).toBeUndefined();
  });
});
