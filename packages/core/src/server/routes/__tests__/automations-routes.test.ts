// packages/core/src/server/routes/__tests__/automations-routes.test.ts
//
// Task 24. Mirrors the v1 workflows routes harness
// (src/__tests__/workflows/routes.test.ts): a real AutomationService on a
// tmp dir, mounted behind a bare express app so routes are exercised
// end-to-end (zod validation, service errors, WS4 envelope) without a real
// HTTP listener.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import pino from 'pino';
import type { AutomationCreateInput } from '@qlan-ro/mainframe-types';
import { AutomationService } from '../../../automations/service.js';
import type { AgentChatPort } from '../../../automations/verbs/ask-agent.js';
import { automationRoutes } from '../automations.js';
import type { RouteContext } from '../types.js';

function fakeAgentPort(): AgentChatPort {
  return {
    async createChatAndSend() {
      return { chatId: 'stub-chat' };
    },
    async sendMessage() {},
  };
}

function makeCtx(service: AutomationService): RouteContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: null as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chats: null as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adapters: null as any,
    automations: service,
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const NOTIFY_ONLY: AutomationCreateInput = {
  name: 'Notify only',
  scope: 'global',
  definition: { triggers: [], steps: [{ id: 'notify-1', kind: 'notify', message: ['hi'] }] },
};

describe('automation REST routes', () => {
  let dir: string;
  let service: AutomationService;
  let app: express.Express;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-routes-'));
    service = new AutomationService({
      dataDir: dir,
      logger: pino({ level: 'silent' }),
      emitEvent: () => {},
      agentPort: fakeAgentPort(),
      listProjects: () => [],
    });
    app = express();
    app.use(express.json());
    app.use(automationRoutes(makeCtx(service)));
  });

  afterEach(() => {
    service.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  // ── list + create ───────────────────────────────────────────────────────

  it('GET /api/automations returns an empty list initially', async () => {
    const res = await request(app).get('/api/automations');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('POST /api/automations creates and the automation appears in the list', async () => {
    const createRes = await request(app).post('/api/automations').send(NOTIFY_ONLY);
    expect(createRes.status).toBe(200);
    expect(createRes.body.data.name).toBe('Notify only');

    const listRes = await request(app).get('/api/automations');
    expect(listRes.body.data.map((a: { id: string }) => a.id)).toContain(createRes.body.data.id);
  });

  it('POST /api/automations returns 400 {errors} for a scope-invalid definition', async () => {
    const res = await request(app)
      .post('/api/automations')
      .send({
        name: 'Bad',
        scope: 'global',
        definition: {
          triggers: [],
          steps: [{ id: 'notify-1', kind: 'notify', message: [{ token: { stepId: 'missing', output: 'x' } }] }],
        },
      });
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors[0].message).toContain("doesn't exist");
  });

  it('POST /api/automations returns 400 for a malformed body', async () => {
    const res = await request(app).post('/api/automations').send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── get / update / delete ───────────────────────────────────────────────

  it('GET /api/automations/:id returns 404 for an unknown id', async () => {
    const res = await request(app).get('/api/automations/no-such-id');
    expect(res.status).toBe(404);
  });

  it('PUT /api/automations/:id updates the stored definition', async () => {
    const created = (await request(app).post('/api/automations').send(NOTIFY_ONLY)).body.data;
    const res = await request(app)
      .put(`/api/automations/${created.id}`)
      .send({ ...NOTIFY_ONLY, name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed');
  });

  it('PUT /api/automations/:id returns 404 for an unknown id', async () => {
    const res = await request(app).put('/api/automations/no-such-id').send(NOTIFY_ONLY);
    expect(res.status).toBe(404);
  });

  it('DELETE /api/automations/:id removes it', async () => {
    const created = (await request(app).post('/api/automations').send(NOTIFY_ONLY)).body.data;
    const res = await request(app).delete(`/api/automations/${created.id}`);
    expect(res.status).toBe(200);

    const listRes = await request(app).get('/api/automations');
    expect(listRes.body.data).toEqual([]);
  });

  it('DELETE /api/automations/:id returns 404 for an unknown id', async () => {
    const res = await request(app).delete('/api/automations/no-such-id');
    expect(res.status).toBe(404);
  });

  // ── enabled toggle ───────────────────────────────────────────────────────

  it('PATCH /api/automations/:id/enabled disables and re-enables', async () => {
    const created = (await request(app).post('/api/automations').send(NOTIFY_ONLY)).body.data;
    expect(created.enabled).toBe(true);

    const offRes = await request(app).patch(`/api/automations/${created.id}/enabled`).send({ enabled: false });
    expect(offRes.status).toBe(200);
    expect(offRes.body).toMatchObject({ success: true, data: { id: created.id, enabled: false } });

    const onRes = await request(app).patch(`/api/automations/${created.id}/enabled`).send({ enabled: true });
    expect(onRes.body.data.enabled).toBe(true);
  });

  it('PATCH /api/automations/:id/enabled rejects a malformed body', async () => {
    const created = (await request(app).post('/api/automations').send(NOTIFY_ONLY)).body.data;
    const res = await request(app).patch(`/api/automations/${created.id}/enabled`).send({ enabled: 'nope' });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/automations/:id/enabled returns 404 for an unknown id', async () => {
    const res = await request(app).patch('/api/automations/no-such-id/enabled').send({ enabled: false });
    expect(res.status).toBe(404);
  });

  // ── runs ─────────────────────────────────────────────────────────────────

  it('POST /api/automations/:id/runs starts a manual run and returns 202', async () => {
    const created = (await request(app).post('/api/automations').send(NOTIFY_ONLY)).body.data;
    const res = await request(app).post(`/api/automations/${created.id}/runs`).send({});
    expect(res.status).toBe(202);
    expect(res.body.data.automationId).toBe(created.id);
    expect(typeof res.body.data.id).toBe('string');
  });

  it('POST /api/automations/:id/runs returns 404 for an unknown automation', async () => {
    const res = await request(app).post('/api/automations/no-such-id/runs').send({});
    expect(res.status).toBe(404);
  });

  it('GET /api/automations/:id/runs lists runs for the automation', async () => {
    const created = (await request(app).post('/api/automations').send(NOTIFY_ONLY)).body.data;
    await request(app).post(`/api/automations/${created.id}/runs`).send({});
    await tick();

    const res = await request(app).get(`/api/automations/${created.id}/runs`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('GET /api/automation-runs/:id returns {run, timeline} with the run summary and step entries', async () => {
    const created = (await request(app).post('/api/automations').send(NOTIFY_ONLY)).body.data;
    const runId = (await request(app).post(`/api/automations/${created.id}/runs`).send({})).body.data.id;
    await tick();

    const res = await request(app).get(`/api/automation-runs/${runId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.run.id).toBe(runId);
    expect(res.body.data.run.status).toBe('succeeded');
    expect(res.body.data.timeline).toHaveLength(1);
    expect(res.body.data.timeline[0].stepId).toBe('notify-1');
  });

  it('GET /api/automation-runs/:id returns 404 for an unknown run', async () => {
    const res = await request(app).get('/api/automation-runs/no-such-id');
    expect(res.status).toBe(404);
  });

  it('GET /api/automation-runs/:id truncates a step output preview beyond 32KB', async () => {
    const created = (await request(app).post('/api/automations').send(NOTIFY_ONLY)).body.data;
    const runId = (await request(app).post(`/api/automations/${created.id}/runs`).send({})).body.data.id;
    await tick();

    service.store.patchCheckpoint(runId, (checkpoint) => {
      const entry = checkpoint.steps['notify-1'];
      if (entry) entry.outputs = { blob: 'x'.repeat(40_000) };
      return checkpoint;
    });

    const res = await request(app).get(`/api/automation-runs/${runId}`);
    expect(res.body.data.timeline[0].outputPreview).toMatch(/^\[truncated — \d+ bytes\]$/);
  });

  it('POST /api/automation-runs/:id/cancel cancels a parked run', async () => {
    const created = (
      await request(app)
        .post('/api/automations')
        .send({
          name: 'Ask me',
          scope: 'global',
          definition: {
            triggers: [],
            steps: [{ id: 'ask-1', kind: 'ask_me', title: 'Pick one', fields: [] }],
          },
        })
    ).body.data;
    const runId = (await request(app).post(`/api/automations/${created.id}/runs`).send({})).body.data.id;
    await tick();

    const cancelRes = await request(app).post(`/api/automation-runs/${runId}/cancel`);
    expect(cancelRes.status).toBe(200);

    const res = await request(app).get(`/api/automation-runs/${runId}`);
    expect(res.body.data.run.status).toBe('cancelled');
  });

  it('POST /api/automation-runs/:id/cancel returns 404 for an unknown run', async () => {
    const res = await request(app).post('/api/automation-runs/no-such-id/cancel');
    expect(res.status).toBe(404);
  });
});
