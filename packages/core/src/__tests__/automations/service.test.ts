// packages/core/src/__tests__/automations/service.test.ts
//
// Task 23: AutomationService owns db/stores/registry/credentials/
// interpreter/scheduler/interaction+wait services and wires them into one
// unit. These tests exercise the four Task 23 scenarios plus a thin CRUD
// surface: create rejects an invalid definition with scope errors; a due
// schedule trigger starts a run; a finished automation's automation.completed
// event chains into a dependent automation via an event trigger; start()
// reconciles resumable runs left by a prior instance.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { AutomationCreateInput, DaemonEvent } from '@qlan-ro/mainframe-types';
import { AutomationService, AutomationValidationError, type AutomationServiceDeps } from '../../automations/service.js';
import type { AgentChatPort } from '../../automations/verbs/ask-agent.js';

function fakeAgentPort(): AgentChatPort {
  return {
    async createChatAndSend() {
      return { chatId: 'stub-chat' };
    },
    async sendMessage() {},
  };
}

function makeService(
  dir: string,
  overrides: Partial<AutomationServiceDeps> = {},
): { service: AutomationService; events: DaemonEvent[] } {
  const events: DaemonEvent[] = [];
  const service: AutomationService = new AutomationService({
    dataDir: dir,
    logger: pino({ level: 'silent' }),
    emitEvent: (event) => {
      events.push(event);
      service.onDaemonEvent(event);
    },
    agentPort: fakeAgentPort(),
    listProjects: () => [],
    ...overrides,
  });
  return { service, events };
}

const NOTIFY_ONLY: AutomationCreateInput = {
  name: 'Notify only',
  scope: 'global',
  definition: { triggers: [], steps: [{ id: 'notify-1', kind: 'notify', message: ['hi'] }] },
};

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('AutomationService', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-service-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('CRUD', () => {
    it('create + get + list round-trip', () => {
      const { service } = makeService(dir);
      const created = service.create(NOTIFY_ONLY);

      expect(service.get(created.id)).toEqual(created);
      expect(service.list().map((a) => a.id)).toContain(created.id);
    });

    it('create rejects a definition with scope errors', () => {
      const { service } = makeService(dir);
      const bad: AutomationCreateInput = {
        name: 'Bad',
        scope: 'global',
        definition: {
          triggers: [],
          steps: [{ id: 'notify-1', kind: 'notify', message: [{ token: { stepId: 'missing', output: 'x' } }] }],
        },
      };

      let caught: unknown;
      try {
        service.create(bad);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AutomationValidationError);
      expect((caught as AutomationValidationError).errors[0]?.message).toContain("doesn't exist");
      expect(service.list()).toHaveLength(0);
    });

    it('update re-validates and persists the new definition', () => {
      const { service } = makeService(dir);
      const created = service.create(NOTIFY_ONLY);

      const updated = service.update(created.id, {
        ...NOTIFY_ONLY,
        name: 'Renamed',
        definition: { triggers: [], steps: [{ id: 'notify-1', kind: 'notify', message: ['bye'] }] },
      });

      expect(updated.name).toBe('Renamed');
      expect(service.get(created.id)?.name).toBe('Renamed');
    });

    it('update rejects an invalid definition without mutating the stored row', () => {
      const { service } = makeService(dir);
      const created = service.create(NOTIFY_ONLY);

      expect(() =>
        service.update(created.id, {
          ...NOTIFY_ONLY,
          definition: {
            triggers: [],
            steps: [{ id: 'notify-1', kind: 'notify', message: [{ token: { stepId: 'missing', output: 'x' } }] }],
          },
        }),
      ).toThrow(AutomationValidationError);
      expect(service.get(created.id)?.definition).toEqual(NOTIFY_ONLY.definition);
    });

    it('setEnabled toggles the flag; manual runs stay allowed while disabled', async () => {
      const { service } = makeService(dir);
      const created = service.create(NOTIFY_ONLY);

      const disabled = service.setEnabled(created.id, false);
      expect(disabled.enabled).toBe(false);

      const run = service.runManually(created.id);
      await tick();
      expect(service.store.getRun(run.id)?.status).toBe('succeeded');
    });
  });

  it('a due schedule trigger starts and completes a run', async () => {
    const { service } = makeService(dir);
    const created = service.create({
      name: 'Scheduled',
      scope: 'global',
      definition: {
        triggers: [
          { id: 'trigger-1', kind: 'schedule', schedule: { type: 'every_n_hours', n: 1 }, onMissed: 'run_once' },
        ],
        steps: [{ id: 'notify-1', kind: 'notify', message: ['hi'] }],
      },
    });

    service.sweep(Date.now() + 65 * 60_000); // past the 1-hour mark the trigger armed against
    await tick();

    const runs = service.store.listRuns(created.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('succeeded');
  });

  it("a finished automation's automation.completed chains into a dependent automation via an event trigger", async () => {
    const { service, events } = makeService(dir);
    const source = service.create(NOTIFY_ONLY);
    const dependent = service.create({
      name: 'Dependent',
      scope: 'global',
      definition: {
        triggers: [{ id: 'chain-1', kind: 'event', event: 'automation.finished', automationId: source.id }],
        steps: [{ id: 'notify-2', kind: 'notify', message: ['chained'] }],
      },
    });

    service.runManually(source.id);
    await tick();
    await tick();

    expect(events.some((e) => e.type === 'automation.completed' && e.automationId === source.id)).toBe(true);
    expect(service.store.listRuns(dependent.id)).toHaveLength(1);
  });

  it('start() reconciles a resumable run left by a prior instance', async () => {
    const { service: service1 } = makeService(dir);
    const created = service1.create({
      name: 'Resume test',
      scope: 'global',
      definition: {
        triggers: [],
        steps: [
          { id: 'a', kind: 'notify', message: ['a'] },
          { id: 'b', kind: 'notify', message: ['b'] },
        ],
      },
    });
    const run = service1.interpreter.startRun(created.id, created.definition, { kind: 'manual' }, null);
    service1.store.patchCheckpoint(run.id, (checkpoint) => {
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
    service1.stop();

    const { service: service2 } = makeService(dir);
    await service2.start();

    expect(service2.store.getRun(run.id)?.status).toBe('succeeded');
    service2.stop();
  });
});
