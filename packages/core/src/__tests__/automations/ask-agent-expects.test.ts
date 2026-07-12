// packages/core/src/__tests__/automations/ask-agent-expects.test.ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { AutomationDefinition, AutomationExpectedOutput, DaemonEvent } from '@qlan-ro/mainframe-types';
import { openAutomationDb, type AutomationDb } from '../../automations/db.js';
import { RunStore } from '../../automations/store/run-store.js';
import { InteractionStore } from '../../automations/store/interaction-store.js';
import type { AutomationRunTriggerContext } from '../../automations/store/types.js';
import { AutomationInterpreter } from '../../automations/engine/interpreter.js';
import type { StepOutcome, VerbPorts } from '../../automations/engine/types.js';
import { makeAskAgentExecutor, type AgentChatPort } from '../../automations/verbs/ask-agent.js';
import { AgentWaitService } from '../../automations/verbs/agent-waits.js';
import { buildOutputContract, parseAndValidate } from '../../automations/verbs/expects.js';

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

function fakeChatPort() {
  const createCalls: { prompt: string }[] = [];
  const sendCalls: { chatId: string; content: string }[] = [];
  const port: AgentChatPort = {
    async createChatAndSend(args) {
      createCalls.push({ prompt: args.prompt });
      return { chatId: 'chat-1' };
    },
    async sendMessage(chatId, content) {
      sendCalls.push({ chatId, content });
    },
  };
  return { port, createCalls, sendCalls };
}

describe('parseAndValidate / buildOutputContract (pure)', () => {
  const expects: AutomationExpectedOutput[] = [
    { key: 'scope', type: 'choice', options: ['xs', 's', 'm'] },
    { key: 'count', type: 'number' },
    { key: 'notes', type: 'text' },
    { key: 'items', type: 'list' },
  ];

  it('buildOutputContract mentions every declared key', () => {
    const contract = buildOutputContract(expects);
    for (const field of expects) expect(contract).toContain(field.key);
  });

  it('extracts the last top-level JSON object, ignoring earlier braces in prose', () => {
    const text = 'Thinking about {this} for a bit.\nDone.\n{"scope":"s","count":3,"notes":"ok","items":["a","b"]}';
    const result = parseAndValidate(text, expects);
    expect(result).toEqual({ ok: true, outputs: { scope: 's', count: 3, notes: 'ok', items: ['a', 'b'] } });
  });

  it('coerces a numeric string', () => {
    const result = parseAndValidate('{"scope":"s","count":"7","notes":"ok","items":[]}', expects);
    expect(result).toEqual({ ok: true, outputs: { scope: 's', count: 7, notes: 'ok', items: [] } });
  });

  it('rejects a choice value outside options', () => {
    const result = parseAndValidate('{"scope":"xl","count":1,"notes":"ok","items":[]}', expects);
    expect(result.ok).toBe(false);
  });

  it('rejects a missing key', () => {
    const result = parseAndValidate('{"scope":"s","count":1,"items":[]}', expects);
    expect(result).toEqual({ ok: false, reason: "missing key 'notes'" });
  });

  it('rejects when no JSON object is present', () => {
    const result = parseAndValidate('no json here', expects);
    expect(result.ok).toBe(false);
  });
});

describe('ask_agent structured outputs (A2)', () => {
  let dir: string;
  let db: AutomationDb;
  let store: RunStore;
  let interactions: InteractionStore;
  let events: DaemonEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-ask-agent-expects-'));
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

  function setUp(step: AutomationDefinition['steps'][number]) {
    const definition: AutomationDefinition = { triggers: [], steps: [step] };
    const { port, createCalls, sendCalls } = fakeChatPort();
    const interpreterBox: { current: AutomationInterpreter | null } = { current: null };
    const waits = new AgentWaitService({
      db,
      store,
      advanceRun: (runId) => interpreterBox.current!.advance(runId),
      emitEvent: (event) => events.push(event),
      logger: silentLogger,
      sendMessage: (chatId, content) => port.sendMessage(chatId, content),
    });
    const ports = fakePorts({ askAgent: makeAskAgentExecutor(port, waits, silentLogger) });
    const interpreter = (interpreterBox.current = new AutomationInterpreter({
      store,
      interactions,
      ports,
      emitEvent: (event) => events.push(event),
      logger: silentLogger,
    }));
    const run = interpreter.startRun('auto-1', definition, MANUAL, null);
    return { interpreter, run, waits, createCalls, sendCalls };
  }

  it('absent expects: unchanged behavior — only result and chatId outputs', async () => {
    const { interpreter, run, waits } = setUp({ id: 'agent-1', kind: 'ask_agent', prompt: ['go'] });
    await interpreter.advance(run.id);
    const { chatId } = waits.findByRunStep(run.id, 'agent-1')!;

    waits.recordAssistantText(chatId, 'plain text reply');
    await waits.onChatFinished(chatId, 'completed');

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('succeeded');
    expect(finished.checkpoint.steps['agent-1']?.outputs).toEqual({ result: 'plain text reply', chatId });
  });

  it('with expects: the output contract is appended to the sent prompt', async () => {
    const expects: AutomationExpectedOutput[] = [{ key: 'scope', type: 'choice', options: ['xs', 's', 'm'] }];
    const { interpreter, run, createCalls } = setUp({ id: 'agent-1', kind: 'ask_agent', prompt: ['Plan it'], expects });
    await interpreter.advance(run.id);

    expect(createCalls[0]?.prompt.startsWith('Plan it')).toBe(true);
    expect(createCalls[0]?.prompt).toContain('scope');
  });

  it('valid final JSON: declared keys become named outputs alongside result/chatId', async () => {
    const expects: AutomationExpectedOutput[] = [
      { key: 'scope', type: 'choice', options: ['xs', 's', 'm'] },
      { key: 'count', type: 'number' },
    ];
    const { interpreter, run, waits, sendCalls } = setUp({ id: 'agent-1', kind: 'ask_agent', prompt: ['go'], expects });
    await interpreter.advance(run.id);
    const { chatId } = waits.findByRunStep(run.id, 'agent-1')!;

    waits.recordAssistantText(chatId, 'Here is my plan.\n{"scope":"s","count":3}');
    await waits.onChatFinished(chatId, 'completed');

    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('succeeded');
    expect(finished.checkpoint.steps['agent-1']?.outputs).toEqual({
      result: 'Here is my plan.\n{"scope":"s","count":3}',
      chatId,
      scope: 's',
      count: 3,
    });
    expect(sendCalls).toHaveLength(0);
  });

  it('mismatch sends ONE corrective message into the same chat and keeps the step waiting', async () => {
    const expects: AutomationExpectedOutput[] = [{ key: 'scope', type: 'choice', options: ['xs', 's', 'm'] }];
    const { interpreter, run, waits, sendCalls } = setUp({ id: 'agent-1', kind: 'ask_agent', prompt: ['go'], expects });
    await interpreter.advance(run.id);
    const { chatId } = waits.findByRunStep(run.id, 'agent-1')!;

    waits.recordAssistantText(chatId, 'no json here');
    await waits.onChatFinished(chatId, 'completed');

    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]?.chatId).toBe(chatId);
    expect(store.getRun(run.id)?.checkpoint.steps['agent-1']?.status).toBe('waiting');
    // No timeoutMinutes set (wakeAt stays null), but the run still reports 'waiting'
    // because RunStore also checks for a waiting checkpoint step.
    expect(store.getRun(run.id)?.status).toBe('waiting');
    // The wait row survives the first mismatch — the run is still waiting on the same chat.
    expect(waits.findByRunStep(run.id, 'agent-1')).toEqual({ chatId });
  });

  it('a second mismatch fails the step loudly and does not send a second correction', async () => {
    const expects: AutomationExpectedOutput[] = [{ key: 'scope', type: 'choice', options: ['xs', 's', 'm'] }];
    const { interpreter, run, waits, sendCalls } = setUp({ id: 'agent-1', kind: 'ask_agent', prompt: ['go'], expects });
    await interpreter.advance(run.id);
    const { chatId } = waits.findByRunStep(run.id, 'agent-1')!;

    waits.recordAssistantText(chatId, 'no json here');
    await waits.onChatFinished(chatId, 'completed');
    waits.recordAssistantText(chatId, 'still no json');
    await waits.onChatFinished(chatId, 'completed');

    expect(sendCalls).toHaveLength(1);
    const finished = store.getRun(run.id)!;
    expect(finished.status).toBe('failed');
    expect(finished.checkpoint.steps['agent-1']?.error).toBe(
      'agent did not return the expected JSON: no JSON object found in the response',
    );
  });

  it('a choice value outside the declared options is treated as a mismatch', async () => {
    const expects: AutomationExpectedOutput[] = [{ key: 'scope', type: 'choice', options: ['xs', 's', 'm'] }];
    const { interpreter, run, waits, sendCalls } = setUp({ id: 'agent-1', kind: 'ask_agent', prompt: ['go'], expects });
    await interpreter.advance(run.id);
    const { chatId } = waits.findByRunStep(run.id, 'agent-1')!;

    waits.recordAssistantText(chatId, '{"scope":"xl"}');
    await waits.onChatFinished(chatId, 'completed');

    expect(sendCalls).toHaveLength(1);
    expect(store.getRun(run.id)?.checkpoint.steps['agent-1']?.status).toBe('waiting');
  });
});
