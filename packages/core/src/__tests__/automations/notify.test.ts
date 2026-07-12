// packages/core/src/__tests__/automations/notify.test.ts
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
import { makeNotifyExecutor, type NotifyPushPort } from '../../automations/verbs/notify.js';

const MANUAL: AutomationRunTriggerContext = { kind: 'manual' };
const silentLogger = pino({ level: 'silent' });

function seedAutomation(db: AutomationDb, id: string, name: string): void {
  db.prepare(
    `INSERT INTO automations (id, name, scope, enabled, definition, created_at, updated_at)
     VALUES (?, ?, 'global', 1, '{}', 0, 0)`,
  ).run(id, name);
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

function fakePush(): { port: NotifyPushPort; calls: Parameters<NotifyPushPort['sendPush']>[0][] } {
  const calls: Parameters<NotifyPushPort['sendPush']>[0][] = [];
  return {
    port: {
      async sendPush(message) {
        calls.push(message);
      },
    },
    calls,
  };
}

describe('notify verb', () => {
  let dir: string;
  let db: AutomationDb;
  let store: RunStore;
  let interactions: InteractionStore;
  let events: DaemonEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-notify-'));
    db = openAutomationDb(join(dir, 'automations.db'));
    seedAutomation(db, 'auto-1', 'Daily Standup');
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

  it('emits automation.notification with the rendered message and no chat links when no agent steps ran', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'notify-1', kind: 'notify', message: ['Standup is ready'] }],
    };
    const ports = fakePorts({
      notify: makeNotifyExecutor({ db, store, emitEvent: (e) => events.push(e), logger: silentLogger }),
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);

    await interpreter.advance(run.id);

    const notification = events.find((e) => e.type === 'automation.notification');
    expect(notification).toEqual({
      type: 'automation.notification',
      runId: run.id,
      automationId: 'auto-1',
      title: 'Daily Standup',
      body: 'Standup is ready',
      links: { runId: run.id, chatIds: [] },
    });
    expect(store.getRun(run.id)?.status).toBe('succeeded');
  });

  it('collects chatIds from prior ask_agent checkpoint steps into links', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'notify-1', kind: 'notify', message: ['done'] }],
    };
    const ports = fakePorts({
      notify: makeNotifyExecutor({ db, store, emitEvent: (e) => events.push(e), logger: silentLogger }),
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    // Seed a prior succeeded ask_agent step directly into the checkpoint, as
    // the real ask_agent executor would leave it after `onChatFinished`.
    store.patchCheckpoint(run.id, (checkpoint) => {
      checkpoint.steps['agent-1'] = {
        stepId: 'agent-1',
        kind: 'ask_agent',
        status: 'succeeded',
        outputs: { result: 'hi', chatId: 'chat-42' },
        error: null,
        startedAt: 0,
        finishedAt: 0,
        chatId: 'chat-42',
      };
      return checkpoint;
    });

    await interpreter.advance(run.id);

    const notification = events.find((e) => e.type === 'automation.notification');
    expect(notification && 'links' in notification ? notification.links.chatIds : undefined).toEqual(['chat-42']);
  });

  it('renders ChipText tokens into the message body', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'notify-1',
          kind: 'notify',
          message: ['Ship complete: ', { token: { stepId: 'builtin', output: 'today' } }],
        },
      ],
    };
    const ports = fakePorts({
      notify: makeNotifyExecutor({ db, store, emitEvent: (e) => events.push(e), logger: silentLogger }),
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);

    await interpreter.advance(run.id);

    const notification = events.find((e) => e.type === 'automation.notification');
    expect(notification && 'body' in notification ? notification.body : undefined).toMatch(
      /^Ship complete: \d{4}-\d{2}-\d{2}$/,
    );
  });

  it('calls PushService.sendPush with the automation name as title when a push port is provided', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'notify-1', kind: 'notify', message: ['Standup is ready'] }],
    };
    const { port: pushService, calls } = fakePush();
    const ports = fakePorts({
      notify: makeNotifyExecutor({ db, store, emitEvent: (e) => events.push(e), pushService, logger: silentLogger }),
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);

    await interpreter.advance(run.id);

    expect(calls).toEqual([
      { title: 'Daily Standup', body: 'Standup is ready', data: { runId: run.id }, priority: 'default' },
    ]);
  });

  it('a push failure logs and never fails the step', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'notify-1', kind: 'notify', message: ['Standup is ready'] }],
    };
    const failingPush: NotifyPushPort = {
      async sendPush() {
        throw new Error('expo is down');
      },
    };
    const warnings: unknown[] = [];
    const logger = pino({ level: 'silent' });
    logger.warn = ((...args: unknown[]) => {
      warnings.push(args);
    }) as typeof logger.warn;
    const ports = fakePorts({
      notify: makeNotifyExecutor({
        db,
        store,
        emitEvent: (e) => events.push(e),
        pushService: failingPush,
        logger,
      }),
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);

    await interpreter.advance(run.id);

    // Push runs fire-and-forget; give its rejection handler a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.getRun(run.id)?.status).toBe('succeeded');
    expect(store.getRun(run.id)?.checkpoint.steps['notify-1']?.status).toBe('succeeded');
    expect(warnings).toHaveLength(1);
  });

  it('does not call sendPush when no push port is provided', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'notify-1', kind: 'notify', message: ['Standup is ready'] }],
    };
    const ports = fakePorts({
      notify: makeNotifyExecutor({ db, store, emitEvent: (e) => events.push(e), logger: silentLogger }),
    });
    const interpreter = makeInterpreter(ports);
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);

    await interpreter.advance(run.id);

    expect(store.getRun(run.id)?.status).toBe('succeeded');
  });
});
