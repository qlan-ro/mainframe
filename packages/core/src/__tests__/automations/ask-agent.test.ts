// packages/core/src/__tests__/automations/ask-agent.test.ts
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

interface FakePortCall {
  projectId: string | undefined;
  adapterId: string;
  model: string | undefined;
  permissionMode: string | undefined;
  worktree: { baseBranch?: string; branchName: string } | undefined;
  prompt: string;
}

function fakeChatPort(chatIds: string[] = ['chat-1', 'chat-2', 'chat-3']): {
  port: AgentChatPort;
  calls: FakePortCall[];
} {
  const calls: FakePortCall[] = [];
  let i = 0;
  const port: AgentChatPort = {
    async createChatAndSend(args) {
      calls.push(args);
      const chatId = chatIds[i++] ?? `chat-${i}`;
      return { chatId };
    },
    async sendMessage() {
      throw new Error('unexpected sendMessage call in Task 19 (no expects wired yet)');
    },
  };
  return { port, calls };
}

describe('ask_agent verb', () => {
  let dir: string;
  let db: AutomationDb;
  let store: RunStore;
  let interactions: InteractionStore;
  let events: DaemonEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-ask-agent-'));
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

  /**
   * `interpreter` is assigned by the caller right after this returns; the
   * closure only calls `.advance()` later (inside `onChatFinished`), by
   * which point the binding is set — same pattern engine-linear.test.ts
   * uses for `onRunFinalized`.
   */
  function makeWaits(getInterpreter: () => AutomationInterpreter, onRunFinalized?: (runId: string) => void) {
    return new AgentWaitService({
      db,
      store,
      advanceRun: (runId) => getInterpreter().advance(runId),
      emitEvent: (event) => events.push(event),
      logger: silentLogger,
      onRunFinalized: onRunFinalized ? (runId) => onRunFinalized(runId) : undefined,
    });
  }

  it('creates a chat once, registers the wait, and parks the run', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'agent-1', kind: 'ask_agent', prompt: ['do the thing'] }],
    };
    const { port, calls } = fakeChatPort();
    const interpreterBox: { current: AutomationInterpreter | null } = { current: null };
    const waits = makeWaits(() => interpreterBox.current!);
    const ports = fakePorts({ askAgent: makeAskAgentExecutor(port, waits, silentLogger) });
    const interpreter = (interpreterBox.current = makeInterpreter(ports));
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);

    await interpreter.advance(run.id);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toBe('do the thing');
    expect(calls[0]?.adapterId).toBe('claude');
    expect(store.getRun(run.id)?.checkpoint.steps['agent-1']?.status).toBe('waiting');
    expect(waits.findByRunStep(run.id, 'agent-1')).toEqual({ chatId: 'chat-1' });
  });

  it('renders the prompt and worktree branchName from tokens', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'agent-1',
          kind: 'ask_agent',
          prompt: ['Ship ', { token: { stepId: 'builtin', output: 'today' } }],
          worktree: { branchName: ['feature/', { token: { stepId: 'trigger', output: 'slug' } }] },
        },
      ],
    };
    const { port, calls } = fakeChatPort();
    const interpreterBox: { current: AutomationInterpreter | null } = { current: null };
    const waits = makeWaits(() => interpreterBox.current!);
    const ports = fakePorts({ askAgent: makeAskAgentExecutor(port, waits, silentLogger) });
    const interpreter = (interpreterBox.current = makeInterpreter(ports));
    const run = interpreter.startRun('auto-1', definition, { kind: 'event', payload: { slug: 'foo' } }, null);

    await interpreter.advance(run.id);

    expect(calls[0]?.prompt).toContain('Ship ');
    expect(calls[0]?.worktree?.branchName).toBe('feature/foo');
  });

  it('a direct re-invocation of the executor for the same run+step does not create a second chat', async () => {
    const step = { id: 'agent-1', kind: 'ask_agent' as const, prompt: ['go'] };
    const ctx: VerbContext = {
      runId: 'run-x',
      stepRef: 'agent-1',
      tokens: { trigger: {}, steps: {}, currentItems: [] },
      signal: new AbortController().signal,
    };
    db.prepare(
      `INSERT INTO automation_runs (id, automation_id, status, trigger_dedup_key, checkpoint, started_at)
       VALUES ('run-x', 'auto-1', 'running', NULL, '{"definition":{"triggers":[],"steps":[]},"trigger":{"kind":"manual"},"steps":{},"wakeAt":null,"error":null}', 0)`,
    ).run();
    const { port, calls } = fakeChatPort();
    const waits = new AgentWaitService({
      db,
      store,
      advanceRun: async () => {},
      emitEvent: (event) => events.push(event),
      logger: silentLogger,
    });
    const askAgent = makeAskAgentExecutor(port, waits, silentLogger);

    const first = await askAgent(step, ctx);
    const second = await askAgent(step, ctx);

    expect(first).toEqual({ type: 'wait', wakeAt: null, kind: 'ask_agent' });
    expect(second).toEqual({ type: 'wait', wakeAt: null, kind: 'ask_agent' });
    expect(calls).toHaveLength(1);
  });

  it('completed: result = accumulated assistant text, chatId output, run succeeds', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'agent-1', kind: 'ask_agent', prompt: ['go'] }],
    };
    const { port } = fakeChatPort();
    const interpreterBox: { current: AutomationInterpreter | null } = { current: null };
    const waits = makeWaits(() => interpreterBox.current!);
    const ports = fakePorts({ askAgent: makeAskAgentExecutor(port, waits, silentLogger) });
    const interpreter = (interpreterBox.current = makeInterpreter(ports));
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    const { chatId } = waits.findByRunStep(run.id, 'agent-1')!;

    waits.recordAssistantText(chatId, 'hello world');
    await waits.onChatFinished(chatId, 'completed');

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('succeeded');
    expect(finished.checkpoint.steps['agent-1']?.outputs).toEqual({ result: 'hello world', chatId });
    expect(waits.findByChat(chatId)).toBeNull();
  });

  it('error without keepGoing fails the step and the whole run', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'agent-1', kind: 'ask_agent', prompt: ['go'] }],
    };
    const { port } = fakeChatPort();
    const interpreterBox: { current: AutomationInterpreter | null } = { current: null };
    const waits = makeWaits(() => interpreterBox.current!);
    const ports = fakePorts({ askAgent: makeAskAgentExecutor(port, waits, silentLogger) });
    const interpreter = (interpreterBox.current = makeInterpreter(ports));
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    const { chatId } = waits.findByRunStep(run.id, 'agent-1')!;

    await waits.onChatFinished(chatId, 'error');

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('failed');
    expect(finished.checkpoint.steps['agent-1']?.status).toBe('failed');
    expect(finished.checkpoint.steps['agent-1']?.error).toBe('agent chat error');
    expect(finished.checkpoint.error).toBe('agent chat error');
    expect(events.some((e) => e.type === 'automation.run.updated' && e.run.status === 'failed')).toBe(true);
  });

  it('interrupted with keepGoing continues the run to the next step', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        { id: 'agent-1', kind: 'ask_agent', prompt: ['go'], keepGoing: true },
        { id: 'notify-1', kind: 'notify', message: ['done'] },
      ],
    };
    const { port } = fakeChatPort();
    const interpreterBox: { current: AutomationInterpreter | null } = { current: null };
    const waits = makeWaits(() => interpreterBox.current!);
    const ports = fakePorts({
      askAgent: makeAskAgentExecutor(port, waits, silentLogger),
      notify: async () => ({ type: 'completed', outputs: {} }),
    });
    const interpreter = (interpreterBox.current = makeInterpreter(ports));
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    await interpreter.advance(run.id);
    const { chatId } = waits.findByRunStep(run.id, 'agent-1')!;

    await waits.onChatFinished(chatId, 'interrupted');

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('succeeded');
    expect(finished.checkpoint.steps['agent-1']?.status).toBe('failed');
    expect(finished.checkpoint.steps['agent-1']?.error).toBe('agent chat interrupted');
    expect(finished.checkpoint.steps['notify-1']?.status).toBe('succeeded');
  });

  it('timeoutMinutes sets a wakeAt deadline on the run', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'agent-1', kind: 'ask_agent', prompt: ['go'], timeoutMinutes: 5 }],
    };
    const { port } = fakeChatPort();
    const interpreterBox: { current: AutomationInterpreter | null } = { current: null };
    const waits = makeWaits(() => interpreterBox.current!);
    const ports = fakePorts({ askAgent: makeAskAgentExecutor(port, waits, silentLogger) });
    const interpreter = (interpreterBox.current = makeInterpreter(ports));
    const before = Date.now();
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);

    await interpreter.advance(run.id);

    const wakeAt = store.getRun(run.id)?.checkpoint.wakeAt;
    expect(wakeAt).not.toBeNull();
    expect(wakeAt!).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(wakeAt!).toBeLessThan(before + 6 * 60_000);
  });

  it('no timeoutMinutes leaves wakeAt null (no deadline)', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'agent-1', kind: 'ask_agent', prompt: ['go'] }],
    };
    const { port } = fakeChatPort();
    const interpreterBox: { current: AutomationInterpreter | null } = { current: null };
    const waits = makeWaits(() => interpreterBox.current!);
    const ports = fakePorts({ askAgent: makeAskAgentExecutor(port, waits, silentLogger) });
    const interpreter = (interpreterBox.current = makeInterpreter(ports));
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);

    await interpreter.advance(run.id);

    expect(store.getRun(run.id)?.checkpoint.wakeAt).toBeNull();
  });

  it('autoApprove set fails the step loudly without creating a chat', async () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'agent-1', kind: 'ask_agent', prompt: ['go'], autoApprove: ['Bash'] }],
    };
    const { port, calls } = fakeChatPort();
    const interpreterBox: { current: AutomationInterpreter | null } = { current: null };
    const waits = makeWaits(() => interpreterBox.current!);
    const ports = fakePorts({ askAgent: makeAskAgentExecutor(port, waits, silentLogger) });
    const interpreter = (interpreterBox.current = makeInterpreter(ports));
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);

    await interpreter.advance(run.id);

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('failed');
    expect(finished.checkpoint.steps['agent-1']?.error).toBe('auto-approve scope not yet supported');
    expect(calls).toHaveLength(0);
  });
});
