// packages/core/src/server/routes/__tests__/automation-admin-routes.test.ts
//
// Task 25. Interactions, action catalog, credentials — mirrors the v1
// workflow-admin.ts harness (src/__tests__/workflows/routes.test.ts).
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
import { automationAdminRoutes } from '../automation-admin.js';
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

const ASK_ME: AutomationCreateInput = {
  name: 'Ask me',
  scope: 'global',
  definition: {
    triggers: [],
    steps: [{ id: 'ask-1', kind: 'ask_me', title: 'Pick one', fields: [{ key: 'choice', type: 'text' }] }],
  },
};

describe('automation admin routes', () => {
  let dir: string;
  let service: AutomationService;
  let app: express.Express;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'automations-admin-'));
    service = new AutomationService({
      dataDir: dir,
      logger: pino({ level: 'silent' }),
      emitEvent: () => {},
      agentPort: fakeAgentPort(),
      listProjects: () => [],
    });
    app = express();
    app.use(express.json());
    app.use(automationAdminRoutes(makeCtx(service)));
  });

  afterEach(() => {
    service.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  // ── interactions ─────────────────────────────────────────────────────────

  it('GET /api/automation-interactions returns an empty list initially', async () => {
    const res = await request(app).get('/api/automation-interactions');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('GET /api/automation-interactions lists a pending interaction after a parked run', async () => {
    const created = service.create(ASK_ME);
    service.runManually(created.id);
    await tick();

    const res = await request(app).get('/api/automation-interactions');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Pick one');
  });

  it('POST /api/automation-interactions/:id/respond resolves the interaction', async () => {
    const created = service.create(ASK_ME);
    service.runManually(created.id);
    await tick();
    const interactionId = service.interactions.listPending()[0]?.id;

    const res = await request(app)
      .post(`/api/automation-interactions/${interactionId}/respond`)
      .send({ response: { choice: 'yes' } });
    expect(res.status).toBe(200);
    expect(service.interactions.listPending()).toHaveLength(0);
  });

  it('POST /api/automation-interactions/:id/respond returns 409 when already answered', async () => {
    const created = service.create(ASK_ME);
    service.runManually(created.id);
    await tick();
    const interactionId = service.interactions.listPending()[0]?.id as string;
    await request(app)
      .post(`/api/automation-interactions/${interactionId}/respond`)
      .send({ response: { choice: 'yes' } });

    const res = await request(app)
      .post(`/api/automation-interactions/${interactionId}/respond`)
      .send({ response: { choice: 'yes' } });
    expect(res.status).toBe(409);
  });

  it('POST /api/automation-interactions/:id/respond returns 404 for an unknown id', async () => {
    const res = await request(app).post('/api/automation-interactions/no-such-id/respond').send({ response: {} });
    expect(res.status).toBe(404);
  });

  // ── action catalog ───────────────────────────────────────────────────────

  it('GET /api/automation-actions returns the builtin + curated catalog with no mcp: entries', async () => {
    const res = await request(app).get('/api/automation-actions');
    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain('run_command');
    expect(ids).toContain('files.read');
    expect(ids.some((id) => id.startsWith('mcp:'))).toBe(false);
  });

  // ── credentials ──────────────────────────────────────────────────────────

  it('credential endpoints never return token values', async () => {
    const putRes = await request(app).put('/api/automation-credentials/my-token').send({ token: 'secret123' });
    expect(putRes.status).toBe(200);

    const listRes = await request(app).get('/api/automation-credentials');
    expect(listRes.body.data.labels).toContain('my-token');
    expect(JSON.stringify(listRes.body)).not.toContain('secret123');

    const getRes = await request(app).get('/api/automation-credentials/my-token');
    expect(getRes.status).toBe(200);
    expect(getRes.body.data).toEqual({ label: 'my-token', kind: 'token' });
    expect(JSON.stringify(getRes.body)).not.toContain('secret123');

    const delRes = await request(app).delete('/api/automation-credentials/my-token');
    expect(delRes.status).toBe(200);
    const after = await request(app).get('/api/automation-credentials');
    expect(after.body.data.labels).not.toContain('my-token');
  });

  it('GET /api/automation-credentials/:label returns 404 for an unknown label', async () => {
    const res = await request(app).get('/api/automation-credentials/no-such-label');
    expect(res.status).toBe(404);
  });

  it('PUT /api/automation-credentials/:label rejects an invalid label', async () => {
    const res = await request(app).put('/api/automation-credentials/my bad label').send({ token: 'x' });
    expect(res.status).toBe(400);
  });

  it('PUT /api/automation-credentials/:label rejects a reserved webhook: label (colon fails the regex)', async () => {
    const res = await request(app).put('/api/automation-credentials/webhook%3Agh-hook').send({ token: 'x' });
    expect(res.status).toBe(400);
  });
});
