// packages/core/src/__tests__/automations/engine-cancel.test.ts
//
// BLOCKER (thermo-nuclear review): cancelRun must be authoritative. A chat
// that finishes after cancellation must not resurrect the run through
// AgentWaitService.onChatFinished, and a verb call already in flight when
// cancelRun fires must not clobber the cancelled status when it eventually
// resolves.
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
import { makeAskAgentExecutor, type AgentChatPort } from '../../automations/verbs/ask-agent.js';
import { AgentWaitService } from '../../automations/verbs/agent-waits.js';

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

function fakeChatPort(): AgentChatPort {
  let i = 0;
  return {
    async createChatAndSend() {
      return { chatId: `chat-${++i}` };
    },
    async sendMessage() {
      throw new Error('unexpected sendMessage call');
    },
  };
}

describe('AutomationInterpreter — cancellation is authoritative', () => {
  let dir: string;
  let db: AutomationDb;
  let store: RunStore;
  let interactions: InteractionStore;
  let events: DaemonEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-cancel-'));
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

  it('cancelling a run parked on ask_agent clears its agent_waits row so a later onChatFinished cannot resurrect it', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        { id: 'agent-1', kind: 'ask_agent', prompt: ['go'] },
        { id: 'notify-1', kind: 'notify', message: ['should never run'] },
      ],
    };
    const notifyCalls: string[] = [];
    const interpreterBox: { current: AutomationInterpreter | null } = { current: null };
    const waits = new AgentWaitService({
      db,
      store,
      advanceRun: (runId) => interpreterBox.current!.advance(runId),
      emitEvent: (event) => events.push(event),
      logger: silentLogger,
      sendMessage: async () => {
        throw new Error('unexpected sendMessage call');
      },
    });
    const ports = fakePorts({
      askAgent: makeAskAgentExecutor(fakeChatPort(), waits, silentLogger),
      notify: async (step) => {
        notifyCalls.push(step.id);
        return { type: 'completed', outputs: {} };
      },
    });
    const interpreter = (interpreterBox.current = new AutomationInterpreter({
      store,
      interactions,
      ports,
      emitEvent: (event) => events.push(event),
      logger: silentLogger,
      agentWaits: waits,
    }));
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    const { chatId } = waits.findByRunStep(run.id, 'agent-1')!;

    await interpreter.cancelRun(run.id);

    expect(store.getRun(run.id)?.status).toBe('cancelled');
    expect(waits.findByRunStep(run.id, 'agent-1')).toBeNull();

    waits.recordAssistantText(chatId, 'done');
    await waits.onChatFinished(chatId, 'completed');

    expect(store.getRun(run.id)?.status).toBe('cancelled');
    expect(store.getRun(run.id)?.checkpoint.steps['agent-1']?.status).toBe('waiting');
    expect(notifyCalls).toEqual([]);
  });

  it('cancelling while a keepGoing run_action step is in flight finalizes cancelled; the walk does not continue when the deferred settles', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        { id: 'run-1', kind: 'run_action', actionId: 'slow-op', params: {}, keepGoing: true },
        { id: 'notify-1', kind: 'notify', message: ['should never run'] },
      ],
    };
    let resolveRun: ((outcome: StepOutcome) => void) | undefined;
    const inFlight = new Promise<StepOutcome>((resolve) => {
      resolveRun = resolve;
    });
    const notifyCalls: string[] = [];
    const ports = fakePorts({
      runAction: async () => inFlight,
      notify: async (step) => {
        notifyCalls.push(step.id);
        return { type: 'completed', outputs: {} };
      },
    });
    const interpreter = new AutomationInterpreter({
      store,
      interactions,
      ports,
      emitEvent: (event) => events.push(event),
      logger: silentLogger,
    });
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);

    const advancePromise = interpreter.advance(run.id);
    // The 'running' marker commit happens synchronously before runAction's
    // returned promise is awaited, so it's already visible here.
    expect(store.getRun(run.id)?.checkpoint.steps['run-1']?.status).toBe('running');

    await interpreter.cancelRun(run.id);
    expect(store.getRun(run.id)?.status).toBe('cancelled');

    resolveRun?.({ type: 'completed', outputs: { output: 'ok', exitCode: 0 } });
    await advancePromise;

    expect(store.getRun(run.id)?.status).toBe('cancelled');
    expect(notifyCalls).toEqual([]);
  });
});
