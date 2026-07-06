// packages/core/src/__tests__/workflows/agent-step.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { openWorkflowDb, type WorkflowDb } from '../../workflows/db.js';
import { RunStore } from '../../workflows/store/run-store.js';
import { WorkflowEngine } from '../../workflows/engine/engine.js';
import { ConnectorRegistry } from '../../workflows/connectors/registry.js';
import { makeAgentExecutor, type AgentChatPort } from '../../workflows/engine/executors/agent.js';
import { AgentWaitService } from '../../workflows/agent-waits.js';

function setup(db: WorkflowDb) {
  const created: Array<{ prompt: string }> = [];
  const port: AgentChatPort = {
    async createChatAndSend(args) {
      created.push({ prompt: args.prompt });
      return { chatId: `chat-${created.length}` };
    },
  };
  const store = new RunStore(db);
  const waits = new AgentWaitService(db, store, pino({ level: 'silent' }));
  const engine = new WorkflowEngine({
    store,
    connectors: new ConnectorRegistry(),
    logger: pino({ level: 'silent' }),
    emitEvent: () => {},
    executors: { agent: makeAgentExecutor(port, waits) },
  });
  waits.bindEngine(engine);
  return { engine, waits, created, store };
}

const DEF = {
  version: 1 as const,
  name: 'ag',
  steps: [
    { id: 'review', agent: { prompt: 'Review ${ inputs.url }', timeoutMinutes: 120 } },
    { id: 'after', set: { text: '${ review.output.text }' } },
  ],
};

describe('agent steps', () => {
  let dir: string;
  let db: WorkflowDb;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfa-'));
    db = openWorkflowDb(join(dir, 'w.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a chat, parks, registers the wait, sets a deadline', async () => {
    const { engine, created, waits } = setup(db);
    const run = engine.startRun({
      workflowId: 'g:ag',
      definition: DEF,
      triggerKind: 'manual',
      inputs: { url: 'http://x' },
      triggerPayload: null,
    });
    await engine.advance(run.id);
    expect(created).toEqual([{ prompt: 'Review http://x' }]);
    expect(engine.store.getRun(run.id)?.status).toBe('waiting');
    expect(engine.store.getRun(run.id)?.wakeAt).toBeGreaterThan(Date.now());
    expect(waits.findByChat('chat-1')?.runId).toBe(run.id);
  });

  it('does not create a second chat on re-advance (scratch survives)', async () => {
    const { engine, created } = setup(db);
    const run = engine.startRun({
      workflowId: 'g:ag',
      definition: DEF,
      triggerKind: 'manual',
      inputs: { url: 'http://x' },
      triggerPayload: null,
    });
    await engine.advance(run.id);
    await engine.advance(run.id); // e.g. spurious wake
    expect(created).toHaveLength(1);
  });

  it('chat completion completes the step with accumulated text and resumes', async () => {
    const { engine, waits } = setup(db);
    const run = engine.startRun({
      workflowId: 'g:ag',
      definition: DEF,
      triggerKind: 'manual',
      inputs: { url: 'http://x' },
      triggerPayload: null,
    });
    await engine.advance(run.id);
    waits.recordAssistantText('chat-1', 'LGTM with nits');
    await waits.onChatFinished('chat-1', 'completed');
    const done = engine.store.getRun(run.id);
    expect(done?.status).toBe('succeeded');
    expect(engine.store.latestStepResults(run.id).get('steps.1')?.output).toEqual({ text: 'LGTM with nits' });
  });

  it('chat error fails the step (retryable per policy)', async () => {
    const { engine, waits } = setup(db);
    const run = engine.startRun({
      workflowId: 'g:ag',
      definition: DEF,
      triggerKind: 'manual',
      inputs: { url: 'http://x' },
      triggerPayload: null,
    });
    await engine.advance(run.id);
    await waits.onChatFinished('chat-1', 'error');
    expect(engine.store.getRun(run.id)?.status).toBe('failed');
  });
});
