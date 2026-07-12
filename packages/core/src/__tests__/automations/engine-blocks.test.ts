// packages/core/src/__tests__/automations/engine-blocks.test.ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { AutomationDefinition, DaemonEvent, NotifyStep } from '@qlan-ro/mainframe-types';
import { openAutomationDb, type AutomationDb } from '../../automations/db.js';
import { RunStore } from '../../automations/store/run-store.js';
import type { AutomationRunTriggerContext } from '../../automations/store/types.js';
import { AutomationInterpreter } from '../../automations/engine/interpreter.js';
import { MAX_REPEAT_ITEMS } from '../../automations/engine/walk.js';
import type { StepOutcome, VerbPorts } from '../../automations/engine/types.js';
import { renderChipText } from '../../automations/tokens/substitute.js';

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

describe('AutomationInterpreter — If/Repeat blocks', () => {
  let dir: string;
  let db: AutomationDb;
  let store: RunStore;
  let events: DaemonEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-blocks-'));
    db = openAutomationDb(join(dir, 'automations.db'));
    seedAutomation(db, 'auto-1');
    store = new RunStore(db);
    events = [];
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function makeInterpreter(ports: VerbPorts) {
    return new AutomationInterpreter({ store, ports, emitEvent: (event) => events.push(event), logger: silentLogger });
  }

  function trigger(payload: unknown): AutomationRunTriggerContext {
    return { kind: 'manual', payload };
  }

  it('picks the then branch when conditions match, otherwise the otherwise branch', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'gate',
          kind: 'if',
          match: 'all',
          conditions: [{ token: { stepId: 'trigger', output: 'scope' }, comparator: 'is', value: 'big' }],
          then: [{ id: 'then-step', kind: 'notify', message: ['big path'] }],
          otherwise: [{ id: 'else-step', kind: 'notify', message: ['small path'] }],
        },
      ],
    };
    const seen: string[] = [];
    const ports = fakePorts({
      notify: async (step) => {
        seen.push(step.id);
        return { type: 'completed', outputs: {} };
      },
    });
    const interpreter = makeInterpreter(ports);

    const bigRun = interpreter.startRun('auto-1', definition, trigger({ scope: 'big' }), null);
    await interpreter.advance(bigRun.id);
    expect(seen).toEqual(['then-step']);
    expect(store.getRun(bigRun.id)?.checkpoint.steps['else-step']).toBeUndefined();

    seen.length = 0;
    const smallRun = interpreter.startRun('auto-1', definition, trigger({ scope: 'small' }), null);
    await interpreter.advance(smallRun.id);
    expect(seen).toEqual(['else-step']);
    expect(store.getRun(smallRun.id)?.checkpoint.steps['then-step']).toBeUndefined();
  });

  it('supports a nested If inside the otherwise branch', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'outer',
          kind: 'if',
          match: 'all',
          conditions: [{ token: { stepId: 'trigger', output: 'scope' }, comparator: 'is', value: 'xs' }],
          then: [{ id: 'xs-step', kind: 'notify', message: ['xs'] }],
          otherwise: [
            {
              id: 'inner',
              kind: 'if',
              match: 'all',
              conditions: [{ token: { stepId: 'trigger', output: 'scope' }, comparator: 'is', value: 's' }],
              then: [{ id: 's-step', kind: 'notify', message: ['s'] }],
              otherwise: [{ id: 'other-step', kind: 'notify', message: ['other'] }],
            },
          ],
        },
      ],
    };
    const seen: string[] = [];
    const ports = fakePorts({
      notify: async (step) => {
        seen.push(step.id);
        return { type: 'completed', outputs: {} };
      },
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, trigger({ scope: 's' }), null);
    await interpreter.advance(run.id);

    expect(seen).toEqual(['s-step']);
    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('succeeded');
  });

  it('runs Repeat inner steps per item with stepRef `<stepId>#<i>`, resolving current + field', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'loop',
          kind: 'repeat',
          items: { stepId: 'trigger', output: 'people' },
          steps: [
            {
              id: 'greet',
              kind: 'notify',
              message: ['Hi ', { token: { stepId: 'current', output: 'item', field: 'name' } }],
            },
          ],
        },
      ],
    };
    const rendered: string[] = [];
    const ports = fakePorts({
      notify: async (step: NotifyStep, ctx) => {
        rendered.push(renderChipText(ctx.tokens, step.message));
        return { type: 'completed', outputs: {} };
      },
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun(
      'auto-1',
      definition,
      trigger({ people: [{ name: 'Ada' }, { name: 'Grace' }] }),
      null,
    );
    await interpreter.advance(run.id);

    expect(rendered).toEqual(['Hi Ada', 'Hi Grace']);
    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('succeeded');
    expect(finished.checkpoint.steps['greet#0']?.status).toBe('succeeded');
    expect(finished.checkpoint.steps['greet#1']?.status).toBe('succeeded');
  });

  it('parks mid-iteration and resumes at the same iteration after wake, without re-running earlier iterations', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'loop',
          kind: 'repeat',
          items: { stepId: 'trigger', output: 'items' },
          steps: [{ id: 'ask', kind: 'ask_me', title: 'Confirm', fields: [] }],
        },
      ],
    };
    let askCalls = 0;
    const ports = fakePorts({
      askMe: async () => {
        askCalls += 1;
        return askCalls === 1 ? { type: 'completed', outputs: {} } : { type: 'wait', wakeAt: null, kind: 'ask_me' };
      },
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, trigger({ items: ['a', 'b'] }), null);
    await interpreter.advance(run.id);

    expect(askCalls).toBe(2);
    const checkpoint = store.getRun(run.id)!.checkpoint;
    expect(checkpoint.steps['ask#0']?.status).toBe('succeeded');
    // ask_me never sets a wakeAt (interactions don't expire), so RunStore's wakeAt-derived
    // run status stays 'running' even though this step itself is 'waiting' on a human.
    expect(checkpoint.steps['ask#1']?.status).toBe('waiting');
    expect(store.getRun(run.id)?.status).toBe('running');

    // Resolve iteration 1's interaction as a real ask_me respond() would, then resume.
    store.patchCheckpoint(run.id, (cp) => {
      cp.steps['ask#1'] = {
        stepId: 'ask',
        kind: 'ask_me',
        status: 'succeeded',
        outputs: {},
        error: null,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      };
      cp.wakeAt = null;
      return cp;
    });
    await interpreter.advance(run.id);

    expect(askCalls).toBe(2); // iteration 0's port never called again
    expect(store.getRun(run.id)?.status).toBe('succeeded');
  });

  it('Repeat over an empty list is a no-op success', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'loop',
          kind: 'repeat',
          items: { stepId: 'trigger', output: 'items' },
          steps: [{ id: 'notify-1', kind: 'notify', message: ['x'] }],
        },
      ],
    };
    const ports = fakePorts({ notify: neverCalled('notify') });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, trigger({ items: [] }), null);
    await interpreter.advance(run.id);

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('succeeded');
    expect(Object.keys(finished.checkpoint.steps)).toEqual([]);
  });

  it('fails loudly before iterating when the list exceeds MAX_REPEAT_ITEMS', async () => {
    const items = Array.from({ length: MAX_REPEAT_ITEMS + 1 }, (_, i) => i);
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'loop',
          kind: 'repeat',
          items: { stepId: 'trigger', output: 'items' },
          steps: [{ id: 'notify-1', kind: 'notify', message: ['x'] }],
        },
      ],
    };
    const ports = fakePorts({ notify: neverCalled('notify') });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, trigger({ items }), null);
    await interpreter.advance(run.id);

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('failed');
    expect(finished.checkpoint.error).toContain('501 items');
    expect(finished.checkpoint.error).toContain(`exceeds the ${MAX_REPEAT_ITEMS}-item limit`);
    expect(Object.keys(finished.checkpoint.steps)).toEqual([]);
  });
});
