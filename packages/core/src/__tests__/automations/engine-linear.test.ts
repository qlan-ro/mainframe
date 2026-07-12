// packages/core/src/__tests__/automations/engine-linear.test.ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { AutomationDefinition, DaemonEvent, NotifyStep } from '@qlan-ro/mainframe-types';
import { openAutomationDb, type AutomationDb } from '../../automations/db.js';
import { RunStore } from '../../automations/store/run-store.js';
import { InteractionStore } from '../../automations/store/interaction-store.js';
import type { AutomationRunTriggerContext } from '../../automations/store/types.js';
import { AutomationInterpreter } from '../../automations/engine/interpreter.js';
import type { StepOutcome, VerbPorts } from '../../automations/engine/types.js';
import { renderChipText } from '../../automations/tokens/substitute.js';

const MANUAL: AutomationRunTriggerContext = { kind: 'manual' };
const silentLogger = pino({ level: 'silent' });

function seedAutomation(db: AutomationDb, id: string): void {
  db.prepare(
    `INSERT INTO automations (id, name, scope, enabled, definition, created_at, updated_at)
     VALUES (?, 'A', 'global', 1, '{}', 0, 0)`,
  ).run(id);
}

function neverCalled(name: string) {
  return async (): Promise<StepOutcome> => {
    throw new Error(`unexpected call to VerbPorts.${name}`);
  };
}

function fakePorts(overrides: Partial<VerbPorts> = {}): VerbPorts {
  return {
    runAction: neverCalled('runAction'),
    askAgent: neverCalled('askAgent'),
    askMe: neverCalled('askMe'),
    notify: neverCalled('notify'),
    ...overrides,
  };
}

describe('AutomationInterpreter — linear walk', () => {
  let dir: string;
  let db: AutomationDb;
  let store: RunStore;
  let interactions: InteractionStore;
  let events: DaemonEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-engine-'));
    db = openAutomationDb(join(dir, 'automations.db'));
    seedAutomation(db, 'auto-1');
    store = new RunStore(db);
    interactions = new InteractionStore(db, store);
    events = [];
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeInterpreter(ports: VerbPorts, onRunFinalized?: (runId: string) => void) {
    return new AutomationInterpreter({
      store,
      interactions,
      ports,
      emitEvent: (event) => events.push(event),
      logger: silentLogger,
      onRunFinalized: onRunFinalized ? (runId) => onRunFinalized(runId) : undefined,
    });
  }

  it('runs steps sequentially and records outputs in the checkpoint by stepRef', async () => {
    const order: string[] = [];
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        { id: 'step-a', kind: 'notify', message: ['a'] },
        { id: 'step-b', kind: 'notify', message: ['b'] },
      ],
    };
    const ports = fakePorts({
      notify: async (step) => {
        order.push(step.id);
        return { type: 'completed', outputs: { sent: step.id } };
      },
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);

    expect(order).toEqual(['step-a', 'step-b']);
    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('succeeded');
    expect(finished.checkpoint.steps['step-a']?.outputs).toEqual({ sent: 'step-a' });
    expect(finished.checkpoint.steps['step-b']?.outputs).toEqual({ sent: 'step-b' });
  });

  it('re-walks the frozen checkpoint.definition, never the live automations row', async () => {
    const original: AutomationDefinition = { triggers: [], steps: [{ id: 'only', kind: 'notify', message: ['x'] }] };
    const mutated: AutomationDefinition = {
      triggers: [],
      steps: [
        { id: 'only', kind: 'notify', message: ['x'] },
        { id: 'sneaky', kind: 'notify', message: ['should never run'] },
      ],
    };
    const ports = fakePorts({ notify: async () => ({ type: 'completed', outputs: {} }) });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', original, MANUAL, null);

    // Mutate the live `automations` row mid-run — the frozen checkpoint must not see it.
    db.prepare(`UPDATE automations SET definition = ? WHERE id = ?`).run(JSON.stringify(mutated), 'auto-1');

    await interpreter.advance(run.id);

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('succeeded');
    expect(Object.keys(finished.checkpoint.steps)).toEqual(['only']);
    expect(finished.checkpoint.definition).toEqual(original);
  });

  it('commits a running marker before a non-idempotent action, then succeeded (both writes land)', async () => {
    const observed: Array<string | undefined> = [];
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'run-1', kind: 'run_action', actionId: 'noop', params: {} }],
    };
    const ports = fakePorts({
      runAction: async (_step, ctx) => {
        observed.push(store.getRun(ctx.runId)?.checkpoint.steps['run-1']?.status);
        return { type: 'completed', outputs: { output: 'ok', exitCode: 0 } };
      },
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);

    // The 'running' marker was already visible to the store when the port ran...
    expect(observed).toEqual(['running']);
    // ...and the final commit landed as 'succeeded'.
    expect(store.getRun(run.id)?.checkpoint.steps['run-1']?.status).toBe('succeeded');
  });

  it('does not write a running marker for ask_me / notify (not listed as non-idempotent in Decision 12)', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        { id: 'ask-1', kind: 'ask_me', title: 'Pick one', fields: [] },
        { id: 'notify-1', kind: 'notify', message: ['hi'] },
      ],
    };
    const statusDuringCall: Array<string | undefined> = [];
    const ports = fakePorts({
      askMe: async (_step, ctx) => {
        statusDuringCall.push(store.getRun(ctx.runId)?.checkpoint.steps['ask-1']?.status);
        return { type: 'completed', outputs: {} };
      },
      notify: async (_step, ctx) => {
        statusDuringCall.push(store.getRun(ctx.runId)?.checkpoint.steps['notify-1']?.status);
        return { type: 'completed', outputs: {} };
      },
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);

    expect(statusDuringCall).toEqual([undefined, undefined]);
  });

  it('a failed step fails the run and records the error in the checkpoint', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'run-1', kind: 'run_action', actionId: 'boom', params: {} }],
    };
    const ports = fakePorts({ runAction: async () => ({ type: 'failed', error: 'boom exploded' }) });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('failed');
    expect(finished.checkpoint.error).toBe('boom exploded');
    expect(finished.checkpoint.steps['run-1']?.status).toBe('failed');
  });

  it('keepGoing:true records the failure, continues, and downstream tokens of the failed step render empty', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        { id: 'run-1', kind: 'run_action', actionId: 'boom', params: {}, keepGoing: true },
        {
          id: 'notify-1',
          kind: 'notify',
          message: ['Result: ', { token: { stepId: 'run-1', output: 'output' } }, '.'],
        },
      ],
    };
    const ports = fakePorts({
      runAction: async () => ({ type: 'failed', error: 'boom exploded' }),
      notify: async (step: NotifyStep, ctx) => ({
        type: 'completed',
        outputs: { rendered: renderChipText(ctx.tokens, step.message) },
      }),
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('succeeded');
    expect(finished.checkpoint.steps['run-1']?.status).toBe('failed');
    expect(finished.checkpoint.steps['run-1']?.error).toBe('boom exploded');
    expect(finished.checkpoint.steps['notify-1']?.outputs).toEqual({ rendered: 'Result: .' });
  });

  it('emits automation.run.updated on start, park, and finalize; onRunFinalized fires only on finalize', async () => {
    const finalized: string[] = [];
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'wait-1', kind: 'ask_me', title: 'Pick one', fields: [] }],
    };
    const wakeAt = Date.now() + 60_000;
    const ports = fakePorts({ askMe: async () => ({ type: 'wait', wakeAt, kind: 'ask_me' }) });
    const interpreter = makeInterpreter(ports, (runId) => finalized.push(runId));
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);

    const runUpdates = events.filter((e) => e.type === 'automation.run.updated');
    expect(runUpdates.length).toBeGreaterThanOrEqual(2); // start + park
    expect(runUpdates.at(-1)?.run.status).toBe('waiting');
    expect(finalized).toEqual([]); // parked, not finalized

    // Resolve externally (as a real ask_me respond() would) then advance again to finalize.
    store.patchCheckpoint(run.id, (checkpoint) => {
      checkpoint.steps['wait-1'] = {
        stepId: 'wait-1',
        kind: 'ask_me',
        status: 'succeeded',
        outputs: {},
        error: null,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      };
      checkpoint.wakeAt = null;
      return checkpoint;
    });
    await interpreter.advance(run.id);

    const finalUpdates = events.filter((e) => e.type === 'automation.run.updated');
    expect(finalUpdates.at(-1)?.run.status).toBe('succeeded');
    expect(finalized).toEqual([run.id]);
  });

  it('advance() is a no-op on an already-terminal run', async () => {
    const definition: AutomationDefinition = { triggers: [], steps: [] };
    const interpreter = makeInterpreter(fakePorts());
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    expect(store.getRun(run.id)?.status).toBe('succeeded');

    events.length = 0;
    await interpreter.advance(run.id);
    expect(events).toEqual([]);
  });

  it('serializes concurrent advance() calls for the same run', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'notify-1', kind: 'notify', message: ['x'] }],
    };
    const ports = fakePorts({
      notify: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 5));
        concurrent -= 1;
        return { type: 'completed', outputs: {} };
      },
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);

    await Promise.all([interpreter.advance(run.id), interpreter.advance(run.id)]);
    expect(maxConcurrent).toBe(1);
  });

  it('cancelRun finalizes the run as cancelled', async () => {
    const definition: AutomationDefinition = { triggers: [], steps: [] };
    const interpreter = makeInterpreter(fakePorts());
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.cancelRun(run.id);
    expect(store.getRun(run.id)?.status).toBe('cancelled');
  });
});
