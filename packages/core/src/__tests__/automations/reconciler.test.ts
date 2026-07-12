// packages/core/src/__tests__/automations/reconciler.test.ts
//
// Task 23. Boot reconciliation, ported from v1 workflows/reconciler.ts:
// a 'running' run just re-advances (the interpreter's own stale-marker
// self-heal, Decision 12, handles it); a 'waiting' ask_agent step whose
// agent_waits row is missing (daemon died between chat creation and wait
// registration) is failed directly — v2 has no 'ambiguous' status, so
// keepGoing decides whether that failure finalizes the whole run or the
// run continues past it.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { AutomationDefinition, DaemonEvent } from '@qlan-ro/mainframe-types';
import { openAutomationDb, type AutomationDb } from '../../automations/db.js';
import { RunStore } from '../../automations/store/run-store.js';
import { InteractionStore } from '../../automations/store/interaction-store.js';
import type { AutomationRunTriggerContext } from '../../automations/store/types.js';
import { AutomationInterpreter } from '../../automations/engine/interpreter.js';
import type { StepOutcome, VerbPorts } from '../../automations/engine/types.js';
import { reconcileAutomationsOnBoot } from '../../automations/reconciler.js';

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

describe('reconcileAutomationsOnBoot', () => {
  let dir: string;
  let db: AutomationDb;
  let store: RunStore;
  let interactions: InteractionStore;
  let events: DaemonEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-reconciler-'));
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

  function makeInterpreter(ports: VerbPorts) {
    return new AutomationInterpreter({
      store,
      interactions,
      ports,
      emitEvent: (e) => events.push(e),
      logger: silentLogger,
    });
  }

  it('re-advances a running run, resuming past already-succeeded steps', async () => {
    const calls: string[] = [];
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        { id: 'a', kind: 'notify', message: ['a'] },
        { id: 'b', kind: 'notify', message: ['b'] },
      ],
    };
    const ports = fakePorts({
      notify: async (step) => {
        calls.push(step.id);
        return { type: 'completed', outputs: {} };
      },
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    store.patchCheckpoint(run.id, (checkpoint) => {
      checkpoint.steps['a'] = {
        stepId: 'a',
        kind: 'notify',
        status: 'succeeded',
        outputs: {},
        error: null,
        startedAt: 1,
        finishedAt: 1,
      };
      return checkpoint;
    });

    await reconcileAutomationsOnBoot(db, store, interpreter, silentLogger);

    expect(calls).toEqual(['b']);
    expect(store.getRun(run.id)?.status).toBe('succeeded');
  });

  it('leaves a waiting ask_agent step alone when its agent_waits row is present', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'agent-1', kind: 'ask_agent', prompt: ['go'] }],
    };
    const ports = fakePorts({ askAgent: async () => ({ type: 'wait', wakeAt: null, kind: 'ask_agent' }) });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    db.prepare(
      `INSERT INTO agent_waits (chat_id, run_id, step_ref, last_assistant_text) VALUES ('chat-1', ?, 'agent-1', NULL)`,
    ).run(run.id);

    await reconcileAutomationsOnBoot(db, store, interpreter, silentLogger);

    const after = store.getRun(run.id)!;
    expect(after.checkpoint.steps['agent-1']?.status).toBe('waiting');
  });

  it('fails a waiting ask_agent step with no agent_waits row and finalizes the run when keepGoing is unset', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'agent-1', kind: 'ask_agent', prompt: ['go'] }],
    };
    const ports = fakePorts({ askAgent: async () => ({ type: 'wait', wakeAt: null, kind: 'ask_agent' }) });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    // No agent_waits row inserted — simulates a daemon crash between chat creation and wait registration.

    await reconcileAutomationsOnBoot(db, store, interpreter, silentLogger);

    const after = store.getRun(run.id)!;
    expect(after.status).toBe('failed');
    expect(after.checkpoint.steps['agent-1']?.status).toBe('failed');
    expect(after.checkpoint.steps['agent-1']?.error).toBe(
      'daemon restarted between chat creation and wait registration',
    );
  });

  it('with keepGoing:true, fails just the orphaned step and completes the rest of the run', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        { id: 'agent-1', kind: 'ask_agent', prompt: ['go'], keepGoing: true },
        { id: 'notify-1', kind: 'notify', message: ['done'] },
      ],
    };
    const ports = fakePorts({
      askAgent: async () => ({ type: 'wait', wakeAt: null, kind: 'ask_agent' }),
      notify: async () => ({ type: 'completed', outputs: {} }),
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);

    await reconcileAutomationsOnBoot(db, store, interpreter, silentLogger);

    const after = store.getRun(run.id)!;
    expect(after.status).toBe('succeeded');
    expect(after.checkpoint.steps['agent-1']?.status).toBe('failed');
    expect(after.checkpoint.steps['notify-1']?.status).toBe('succeeded');
  });

  it('leaves a waiting ask_me step untouched (question waits are self-sufficient)', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'ask-1', kind: 'ask_me', title: 'Pick', fields: [] }],
    };
    const ports = fakePorts({ askMe: async () => ({ type: 'wait', wakeAt: null, kind: 'ask_me' }) });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);

    await reconcileAutomationsOnBoot(db, store, interpreter, silentLogger);

    expect(store.getRun(run.id)?.checkpoint.steps['ask-1']?.status).toBe('waiting');
  });
});
