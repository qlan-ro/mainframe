// packages/core/src/__tests__/automations/ask-me.test.ts
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
import type { StepOutcome, VerbPorts, VerbContext } from '../../automations/engine/types.js';
import { resolveToken } from '../../automations/tokens/substitute.js';
import { makeAskMeExecutor, InteractionService } from '../../automations/verbs/ask-me.js';

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

describe('ask_me verb', () => {
  let dir: string;
  let db: AutomationDb;
  let store: RunStore;
  let interactions: InteractionStore;
  let events: DaemonEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-ask-me-'));
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
      emitEvent: (event) => events.push(event),
      logger: silentLogger,
    });
  }

  it('pauses on ask_me, then respond() writes answers as per-field tokens and advances the run', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'ask-1',
          kind: 'ask_me',
          title: 'Mood?',
          fields: [{ key: 'mood', type: 'choice', options: ['good', 'bad'], required: true }],
        },
        { id: 'notify-1', kind: 'notify', message: ['done'] },
      ],
    };
    let resolvedMood: unknown;
    const ports = fakePorts({
      askMe: makeAskMeExecutor(interactions, (event) => events.push(event)),
      notify: async (_step, ctx: VerbContext) => {
        resolvedMood = resolveToken(ctx.tokens, { stepId: 'ask-1', output: 'mood' });
        return { type: 'completed', outputs: {} };
      },
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    // ask_me never sets a wakeAt, so the run's wakeAt-derived status stays 'running'
    // even while the step itself is 'waiting' (engine-blocks.test.ts documents this too).
    expect(store.getRun(run.id)?.checkpoint.steps['ask-1']?.status).toBe('waiting');

    const interaction = interactions.findPendingForStep(run.id, 'ask-1');
    expect(interaction).not.toBeNull();

    const service = new InteractionService(
      interactions,
      (runId) => interpreter.advance(runId),
      (event) => events.push(event),
    );
    await service.respond(interaction!.id, { mood: 'good' });

    expect(resolvedMood).toBe('good');
    expect(store.getRun(run.id)?.status).toBe('succeeded');
    expect(events.some((e) => e.type === 'automation.interaction.resolved')).toBe(true);
  });

  it('emits automation.interaction.created exactly once and never re-creates on pending re-entry', async () => {
    const step = { id: 'ask-1', kind: 'ask_me' as const, title: 'Mood?', fields: [] };
    const ctx: VerbContext = {
      runId: 'run-x',
      stepRef: 'ask-1',
      tokens: { trigger: {}, steps: {}, currentItems: [] },
      signal: new AbortController().signal,
    };
    db.prepare(
      `INSERT INTO automation_runs (id, automation_id, status, trigger_dedup_key, checkpoint, started_at)
       VALUES ('run-x', 'auto-1', 'running', NULL, '{"definition":{"triggers":[],"steps":[]},"trigger":{"kind":"manual"},"steps":{},"wakeAt":null,"error":null}', 0)`,
    ).run();
    const askMe = makeAskMeExecutor(interactions, (event) => events.push(event));

    const first = await askMe(step, ctx);
    const second = await askMe(step, ctx);

    expect(first).toEqual({ type: 'wait', wakeAt: null, kind: 'ask_me' });
    expect(second).toEqual({ type: 'wait', wakeAt: null, kind: 'ask_me' });
    expect(interactions.listPending()).toHaveLength(1);
    expect(events.filter((e) => e.type === 'automation.interaction.created')).toHaveLength(1);
  });

  it('claim + checkpoint write commit atomically: an injected mid-write failure rolls back both', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'ask-1', kind: 'ask_me', title: 'Notes?', fields: [{ key: 'notes', type: 'text' }] }],
    };
    const ports = fakePorts({ askMe: makeAskMeExecutor(interactions, (event) => events.push(event)) });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    const interaction = interactions.findPendingForStep(run.id, 'ask-1')!;
    const service = new InteractionService(
      interactions,
      (runId) => interpreter.advance(runId),
      (event) => events.push(event),
    );

    const oversized = 'x'.repeat(5 * 1024 * 1024);
    await expect(service.respond(interaction.id, { notes: oversized })).rejects.toThrow(/write large data to a file/);

    expect(interactions.get(interaction.id)?.status).toBe('pending');
    expect(store.getRun(run.id)?.checkpoint.steps['ask-1']?.status).toBe('waiting');
  });

  it('rejects a double respond with "already answered"', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'ask-1', kind: 'ask_me', title: 'Notes?', fields: [{ key: 'notes', type: 'text' }] }],
    };
    const ports = fakePorts({ askMe: makeAskMeExecutor(interactions, (event) => events.push(event)) });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    const interaction = interactions.findPendingForStep(run.id, 'ask-1')!;
    const service = new InteractionService(
      interactions,
      (runId) => interpreter.advance(runId),
      (event) => events.push(event),
    );

    await service.respond(interaction.id, { notes: 'first' });

    await expect(service.respond(interaction.id, { notes: 'second' })).rejects.toThrow(/already answered/);
  });

  it('rejects a respond after the run cancelled the pending interaction', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'ask-1', kind: 'ask_me', title: 'Notes?', fields: [] }],
    };
    const ports = fakePorts({ askMe: makeAskMeExecutor(interactions, (event) => events.push(event)) });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    const interaction = interactions.findPendingForStep(run.id, 'ask-1')!;
    await interpreter.cancelRun(run.id);
    expect(interactions.get(interaction.id)?.status).toBe('cancelled');

    const service = new InteractionService(
      interactions,
      (runId) => interpreter.advance(runId),
      (event) => events.push(event),
    );

    await expect(service.respond(interaction.id, {})).rejects.toThrow(/cancelled/);
  });

  it('rejects a choice value outside the declared options', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'ask-1',
          kind: 'ask_me',
          title: 'Mood?',
          fields: [{ key: 'mood', type: 'choice', options: ['good', 'bad'] }],
        },
      ],
    };
    const ports = fakePorts({ askMe: makeAskMeExecutor(interactions, (event) => events.push(event)) });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    const interaction = interactions.findPendingForStep(run.id, 'ask-1')!;
    const service = new InteractionService(
      interactions,
      (runId) => interpreter.advance(runId),
      (event) => events.push(event),
    );

    await expect(service.respond(interaction.id, { mood: 'purple' })).rejects.toThrow(/invalid response/);
    expect(interactions.get(interaction.id)?.status).toBe('pending');
  });

  it('skips validation for a field hidden by showWhen', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'ask-1',
          kind: 'ask_me',
          title: 'Detail?',
          fields: [
            { key: 'wantsDetail', type: 'choice', options: ['yes', 'no'], required: true },
            { key: 'detail', type: 'text', required: true, showWhen: { key: 'wantsDetail', equals: 'yes' } },
          ],
        },
      ],
    };
    const ports = fakePorts({ askMe: makeAskMeExecutor(interactions, (event) => events.push(event)) });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    const interaction = interactions.findPendingForStep(run.id, 'ask-1')!;
    const service = new InteractionService(
      interactions,
      (runId) => interpreter.advance(runId),
      (event) => events.push(event),
    );

    await service.respond(interaction.id, { wantsDetail: 'no' });

    expect(store.getRun(run.id)?.status).toBe('succeeded');
    expect(store.getRun(run.id)?.checkpoint.steps['ask-1']?.outputs).toEqual({ wantsDetail: 'no' });
  });
});
