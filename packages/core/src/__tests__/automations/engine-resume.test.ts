// packages/core/src/__tests__/automations/engine-resume.test.ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { AutomationDefinition, AutomationStep, DaemonEvent } from '@qlan-ro/mainframe-types';
import { openAutomationDb, type AutomationDb } from '../../automations/db.js';
import { RunStore } from '../../automations/store/run-store.js';
import { InteractionStore } from '../../automations/store/interaction-store.js';
import type { AutomationRunTriggerContext } from '../../automations/store/types.js';
import { AutomationInterpreter } from '../../automations/engine/interpreter.js';
import type { StepOutcome, VerbPorts } from '../../automations/engine/types.js';

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

describe('AutomationInterpreter — resume, cancel, park/wake', () => {
  let dir: string;
  let db: AutomationDb;
  let store: RunStore;
  let interactions: InteractionStore;
  let events: DaemonEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-resume-'));
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

  function makeInterpreter(ports: VerbPorts, isIdempotent?: (step: AutomationStep) => boolean) {
    return new AutomationInterpreter({
      store,
      interactions,
      ports,
      emitEvent: (event) => events.push(event),
      logger: silentLogger,
      isIdempotent,
    });
  }

  it('a fresh interpreter instance resumes a running run without re-executing succeeded steps', async () => {
    const calls: string[] = [];
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        { id: 'step-a', kind: 'notify', message: ['a'] },
        { id: 'step-b', kind: 'notify', message: ['b'] },
      ],
    };
    const ports = fakePorts({
      notify: async (step) => {
        calls.push(step.id);
        return { type: 'completed', outputs: {} };
      },
    });
    const interpreter1 = makeInterpreter(ports);
    const run = interpreter1.startRun('auto-1', definition, MANUAL, null);

    // Simulate a crash right after step-a committed, before interpreter1 ever advanced.
    store.patchCheckpoint(run.id, (checkpoint) => {
      checkpoint.steps['step-a'] = {
        stepId: 'step-a',
        kind: 'notify',
        status: 'succeeded',
        outputs: {},
        error: null,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      };
      return checkpoint;
    });

    const interpreter2 = makeInterpreter(ports);
    await interpreter2.advance(run.id);

    expect(calls).toEqual(['step-b']);
    expect(store.getRun(run.id)?.status).toBe('succeeded');
  });

  it('a stale running run_action marker re-runs when the action is idempotent', async () => {
    let calls = 0;
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'run-1', kind: 'run_action', actionId: 'idempotent-op', params: {} }],
    };
    const ports = fakePorts({
      runAction: async () => {
        calls += 1;
        return { type: 'completed', outputs: { output: 'ok', exitCode: 0 } };
      },
    });
    const interpreter = makeInterpreter(ports, () => true);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    store.patchCheckpoint(run.id, (checkpoint) => {
      checkpoint.steps['run-1'] = {
        stepId: 'run-1',
        kind: 'run_action',
        status: 'running',
        outputs: null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      };
      return checkpoint;
    });

    await interpreter.advance(run.id);

    expect(calls).toBe(1);
    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('succeeded');
    expect(finished.checkpoint.steps['run-1']?.status).toBe('succeeded');
  });

  it('a stale running run_action marker fails the run loudly by default (non-idempotent)', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'run-1', kind: 'run_action', actionId: 'risky-op', params: {} }],
    };
    const ports = fakePorts({ runAction: neverCalled('runAction') });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    store.patchCheckpoint(run.id, (checkpoint) => {
      checkpoint.steps['run-1'] = {
        stepId: 'run-1',
        kind: 'run_action',
        status: 'running',
        outputs: null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      };
      return checkpoint;
    });

    await interpreter.advance(run.id);

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('failed');
    expect(finished.checkpoint.error).toBe('engine restarted mid-action; effect unknown');
    expect(finished.checkpoint.steps['run-1']?.status).toBe('failed');
  });

  it('keepGoing:true on the stale step fails just that step and continues the run', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        { id: 'run-1', kind: 'run_action', actionId: 'risky-op', params: {}, keepGoing: true },
        { id: 'notify-1', kind: 'notify', message: ['done'] },
      ],
    };
    const ports = fakePorts({
      runAction: neverCalled('runAction'),
      notify: async () => ({ type: 'completed', outputs: {} }),
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    store.patchCheckpoint(run.id, (checkpoint) => {
      checkpoint.steps['run-1'] = {
        stepId: 'run-1',
        kind: 'run_action',
        status: 'running',
        outputs: null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      };
      return checkpoint;
    });

    await interpreter.advance(run.id);

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('succeeded');
    expect(finished.checkpoint.steps['run-1']?.status).toBe('failed');
    expect(finished.checkpoint.steps['run-1']?.error).toBe('engine restarted mid-action; effect unknown');
    expect(finished.checkpoint.steps['notify-1']?.status).toBe('succeeded');
  });

  it('a stale running ask_agent marker always fails loudly, even with an idempotent hook', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'agent-1', kind: 'ask_agent', prompt: ['go'] }],
    };
    const ports = fakePorts({ askAgent: neverCalled('askAgent') });
    const interpreter = makeInterpreter(ports, () => true); // never consulted for ask_agent
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    store.patchCheckpoint(run.id, (checkpoint) => {
      checkpoint.steps['agent-1'] = {
        stepId: 'agent-1',
        kind: 'ask_agent',
        status: 'running',
        outputs: null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      };
      return checkpoint;
    });

    await interpreter.advance(run.id);

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('failed');
    expect(finished.checkpoint.error).toBe('engine restarted mid-action; effect unknown');
  });

  it('cancelRun aborts, finalizes cancelled, and cancels pending interactions for the run', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'ask-1', kind: 'ask_me', title: 'Pick', fields: [] }],
    };
    const ports = fakePorts({ askMe: async () => ({ type: 'wait', wakeAt: null, kind: 'ask_me' }) });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);

    const interaction = interactions.create({ runId: run.id, stepRef: 'ask-1', title: 'Pick', fields: [] });
    expect(interaction.status).toBe('pending');

    await interpreter.cancelRun(run.id);

    expect(store.getRun(run.id)?.status).toBe('cancelled');
    expect(interactions.get(interaction.id)?.status).toBe('cancelled');
  });

  it('sweepDeadlines fails a waiting ask_agent step past its wakeAt and, with keepGoing, advances the run to completion', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        { id: 'agent-1', kind: 'ask_agent', prompt: ['go'], keepGoing: true },
        { id: 'notify-1', kind: 'notify', message: ['done'] },
      ],
    };
    const wakeAt = Date.now() - 1000;
    const ports = fakePorts({
      askAgent: async () => ({ type: 'wait', wakeAt, kind: 'ask_agent' }),
      notify: async () => ({ type: 'completed', outputs: {} }),
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    expect(store.getRun(run.id)?.checkpoint.steps['agent-1']?.status).toBe('waiting');

    await interpreter.sweepDeadlines();

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('succeeded');
    expect(finished.checkpoint.steps['agent-1']?.status).toBe('failed');
    expect(finished.checkpoint.steps['agent-1']?.error).toBe('agent step deadline exceeded');
    expect(finished.checkpoint.steps['notify-1']?.status).toBe('succeeded');
  });

  it('sweepDeadlines without keepGoing fails the whole run', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'agent-1', kind: 'ask_agent', prompt: ['go'] }],
    };
    const wakeAt = Date.now() - 1000;
    const ports = fakePorts({ askAgent: async () => ({ type: 'wait', wakeAt, kind: 'ask_agent' }) });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);

    await interpreter.sweepDeadlines();

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('failed');
    expect(finished.checkpoint.error).toBe('agent step deadline exceeded');
    expect(finished.checkpoint.steps['agent-1']?.status).toBe('failed');
  });

  it('sweepDeadlines ignores waiting runs whose wakeAt has not passed yet', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'agent-1', kind: 'ask_agent', prompt: ['go'] }],
    };
    const wakeAt = Date.now() + 60_000;
    const ports = fakePorts({ askAgent: async () => ({ type: 'wait', wakeAt, kind: 'ask_agent' }) });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);

    await interpreter.sweepDeadlines();

    expect(store.getRun(run.id)?.checkpoint.steps['agent-1']?.status).toBe('waiting');
  });
});
