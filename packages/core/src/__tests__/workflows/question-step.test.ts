import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { openWorkflowDb, type WorkflowDb } from '../../workflows/db.js';
import { RunStore } from '../../workflows/store/run-store.js';
import { InteractionStore } from '../../workflows/store/interaction-store.js';
import { WorkflowEngine } from '../../workflows/engine/engine.js';
import { ConnectorRegistry } from '../../workflows/connectors/registry.js';
import { makeQuestionExecutor } from '../../workflows/engine/executors/question.js';
import { InteractionService } from '../../workflows/interactions.js';

function setup(db: WorkflowDb) {
  const store = new RunStore(db);
  const interactions = new InteractionStore(db);
  const engine = new WorkflowEngine({
    store,
    connectors: new ConnectorRegistry(),
    logger: pino({ level: 'silent' }),
    emitEvent: () => {},
    executors: { question: makeQuestionExecutor(interactions) },
  });
  const service = new InteractionService(interactions, store, engine, pino({ level: 'silent' }), () => {});
  return { engine, interactions, service, store };
}

const DEF = {
  version: 1 as const,
  name: 'qstep',
  steps: [
    {
      id: 'ask',
      question: {
        title: 'Mood?',
        timeout: { afterMinutes: 60, onTimeout: 'cancel' as const },
        fields: [{ key: 'mood', type: 'choice' as const, options: ['happy', 'sad'], required: true }],
      },
    },
    { id: 'echo', set: { mood: '${ ask.output.mood }' } },
  ],
};

describe('question steps', () => {
  let dir: string;
  let db: WorkflowDb;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfq-'));
    db = openWorkflowDb(join(dir, 'w.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('parks the run with a pending interaction (status waiting, wakeAt set)', async () => {
    const { engine, interactions } = setup(db);
    const run = engine.startRun({
      workflowId: 'g:qstep',
      definition: DEF,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    await engine.advance(run.id);

    expect(engine.store.getRun(run.id)?.status).toBe('waiting');
    const pending = interactions.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.title).toBe('Mood?');
    const wakeAt = engine.store.getRun(run.id)?.wakeAt;
    expect(wakeAt).not.toBeNull();
    expect(wakeAt).toBeGreaterThan(Date.now());
  });

  it('sets scratch.waitFor to the question title on the waiting outcome', async () => {
    const { engine } = setup(db);
    const run = engine.startRun({
      workflowId: 'g:qstep',
      definition: DEF,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    await engine.advance(run.id);

    const askResult = engine.store.latestStepResults(run.id).get('steps.0');
    expect(askResult?.status).toBe('waiting');
    expect((askResult?.scratch as { waitFor?: string } | null)?.waitFor).toBe('Mood?');
  });

  it('respond validates, completes the step, and resumes (echo reads ask.output.mood)', async () => {
    const { engine, interactions, service } = setup(db);
    const run = engine.startRun({
      workflowId: 'g:qstep',
      definition: DEF,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    await engine.advance(run.id);

    const pending = interactions.listPending()[0];
    if (!pending) throw new Error('no pending interaction');
    await service.respond(pending.id, { mood: 'happy' });

    const done = engine.store.getRun(run.id);
    expect(done?.status).toBe('succeeded');
    expect(engine.store.latestStepResults(run.id).get('steps.1')?.output).toEqual({ mood: 'happy' });
  });

  it('rejects an invalid response (bad enum value) and the run stays pending', async () => {
    const { engine, interactions, service } = setup(db);
    const run = engine.startRun({
      workflowId: 'g:qstep',
      definition: DEF,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    await engine.advance(run.id);

    const pending = interactions.listPending()[0];
    if (!pending) throw new Error('no pending interaction');
    await expect(service.respond(pending.id, { mood: 'angry' })).rejects.toThrow(/invalid response/i);
    expect(engine.store.getRun(run.id)?.status).toBe('waiting');
  });

  it('rejects a second response (already answered)', async () => {
    const { engine, interactions, service } = setup(db);
    const run = engine.startRun({
      workflowId: 'g:qstep',
      definition: DEF,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    await engine.advance(run.id);

    const pending = interactions.listPending()[0];
    if (!pending) throw new Error('no pending interaction');
    await service.respond(pending.id, { mood: 'happy' });
    await expect(service.respond(pending.id, { mood: 'sad' })).rejects.toThrow(/already answered/i);
  });

  it('expire applies onTimeout: cancel and the run becomes cancelled', async () => {
    const { engine, service } = setup(db);
    const run = engine.startRun({
      workflowId: 'g:qstep',
      definition: DEF,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });
    await engine.advance(run.id);
    await service.expireDue(Date.now() + 61 * 60_000);
    expect(engine.store.getRun(run.id)?.status).toBe('cancelled');
  });
});
