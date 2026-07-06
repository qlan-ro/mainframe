import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import pino from 'pino';
import { WorkflowService } from '../../workflows/index.js';
import { workflowRoutes } from '../../server/routes/workflows.js';
import type { RouteContext } from '../../server/routes/types.js';

// Minimal RouteContext stub — workflow routes only use ctx.workflows.
function makeCtx(service: WorkflowService): RouteContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: null as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chats: null as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adapters: null as any,
    workflows: service,
  };
}

const VALID_YAML = `
version: 1
name: greet
inputs:
  who:
    type: string
    required: true
steps:
  - id: say
    set:
      msg: "\${ 'Hello ' & inputs.who }"
`.trimStart();

const VALID_NO_INPUTS = `
version: 1
name: simple
steps:
  - id: say
    set:
      msg: "hi"
`.trimStart();

const INVALID_YAML = `
version: 1
name: bad
steps:
  - id: a
    set:
      v: "\${ ghost.output }"
`.trimStart();

describe('workflow REST routes', () => {
  let dir: string;
  let wfDir: string;
  let service: WorkflowService;
  let app: express.Express;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'wfroutes-'));
    wfDir = join(dir, 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'simple.yml'), VALID_NO_INPUTS);

    service = new WorkflowService({
      dataDir: dir,
      logger: pino({ level: 'silent' }),
      emitEvent: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentPort: null as any,
      listProjects: () => [],
    });
    await service.rescan();

    const ctx = makeCtx(service);
    app = express();
    app.use(express.json());
    app.use(workflowRoutes(ctx));
  });

  afterEach(() => {
    service.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  // ── list ────────────────────────────────────────────────────────────────────

  it('GET /api/workflows lists scanned workflows', async () => {
    const res = await request(app).get('/api/workflows');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('simple');
  });

  // ── rescan ──────────────────────────────────────────────────────────────────

  it('POST /api/workflows/rescan returns errors list', async () => {
    const res = await request(app).post('/api/workflows/rescan');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.errors)).toBe(true);
  });

  // ── start run ───────────────────────────────────────────────────────────────

  it('POST /api/workflows/:id/runs starts a run and returns 202 with a tree on GET', async () => {
    const wfId = encodeURIComponent('global:simple');
    const startRes = await request(app).post(`/api/workflows/${wfId}/runs`).send({});
    expect(startRes.status).toBe(202);
    expect(startRes.body.success).toBe(true);
    const runId: string = startRes.body.data.id;
    expect(typeof runId).toBe('string');

    // Wait a tick for the engine to finish (simple set-step runs synchronously)
    await new Promise((r) => setTimeout(r, 50));

    const getRes = await request(app).get(`/api/workflow-runs/${runId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.run.id).toBe(runId);
    expect(Array.isArray(getRes.body.data.tree)).toBe(true);
    expect(getRes.body.data.tree[0].kind).toBe('set');
  });

  it('POST /api/workflows/:id/runs returns 400 for missing required inputs', async () => {
    // Write the greet workflow which requires 'who'
    writeFileSync(join(wfDir, 'greet.yml'), VALID_YAML);
    await service.rescan();

    const wfId = encodeURIComponent('global:greet');
    const res = await request(app).post(`/api/workflows/${wfId}/runs`).send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/who/);
  });

  // ── run detail with display-truncation ───────────────────────────────────────

  it('GET /api/workflow-runs/:runId truncates large output in the tree', async () => {
    const wfId = encodeURIComponent('global:simple');
    const startRes = await request(app).post(`/api/workflows/${wfId}/runs`).send({});
    expect(startRes.status).toBe(202);
    const runId: string = startRes.body.data.id;
    await new Promise((r) => setTimeout(r, 50));

    const res = await request(app).get(`/api/workflow-runs/${runId}`);
    expect(res.status).toBe(200);
    // tree nodes have a `truncated` boolean
    const node = res.body.data.tree[0];
    expect('truncated' in node).toBe(true);
  });

  // ── cancel ──────────────────────────────────────────────────────────────────

  it('POST /api/workflow-runs/:runId/cancel returns 200 empty', async () => {
    const wfId = encodeURIComponent('global:simple');
    const startRes = await request(app).post(`/api/workflows/${wfId}/runs`).send({});
    const runId: string = startRes.body.data.id;

    const res = await request(app).post(`/api/workflow-runs/${runId}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ── interactions ────────────────────────────────────────────────────────────

  it('GET /api/workflow-interactions returns empty list initially', async () => {
    const res = await request(app).get('/api/workflow-interactions');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('POST /api/workflow-interactions/:id/respond to unknown id returns 404', async () => {
    const res = await request(app).post('/api/workflow-interactions/no-such-id/respond').send({ response: {} });
    expect(res.status).toBe(404);
  });

  // ── connectors ──────────────────────────────────────────────────────────────

  it('GET /api/workflow-connectors returns catalog', async () => {
    const res = await request(app).get('/api/workflow-connectors');
    expect(res.status).toBe(200);
    const catalog = res.body.data as Array<{ id: string }>;
    expect(catalog.map((c) => c.id).sort()).toEqual(['bash', 'files', 'http']);
  });

  // ── credentials ─────────────────────────────────────────────────────────────

  it('credential endpoints never return token values', async () => {
    // Set a credential.
    const putRes = await request(app).put('/api/workflow-credentials/my-token').send({ token: 'secret123' });
    expect(putRes.status).toBe(200);

    // List should return only labels.
    const listRes = await request(app).get('/api/workflow-credentials');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.labels).toContain('my-token');
    expect(JSON.stringify(listRes.body)).not.toContain('secret123');

    // DELETE removes it.
    const delRes = await request(app).delete('/api/workflow-credentials/my-token');
    expect(delRes.status).toBe(200);
    const after = await request(app).get('/api/workflow-credentials');
    expect(after.body.data.labels).not.toContain('my-token');
  });

  it('PUT /api/workflow-credentials/:label rejects invalid label', async () => {
    const res = await request(app).put('/api/workflow-credentials/my bad label').send({ token: 'x' });
    expect(res.status).toBe(400);
  });

  // ── validate ────────────────────────────────────────────────────────────────

  it('POST /api/workflows/validate returns valid:true for good YAML', async () => {
    const res = await request(app).post('/api/workflows/validate').send({ yaml: VALID_NO_INPUTS });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.errors).toEqual([]);
  });

  it('POST /api/workflows/validate returns valid:false with errors for bad YAML', async () => {
    const res = await request(app).post('/api/workflows/validate').send({ yaml: INVALID_YAML });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.errors.length).toBeGreaterThan(0);
  });

  it('POST /api/workflows/validate returns 400 for non-parseable YAML', async () => {
    const res = await request(app).post('/api/workflows/validate').send({ yaml: 'not: valid: yaml: ::' });
    expect(res.status).toBe(400);
  });

  // ── write (PUT) ─────────────────────────────────────────────────────────────

  it('PUT /api/workflows/:id writes and the workflow appears after rescan', async () => {
    const wfId = encodeURIComponent('global:greet');
    const res = await request(app).put(`/api/workflows/${wfId}`).send({ yaml: VALID_YAML });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('greet');

    // Should now be visible in the list.
    const list = await request(app).get('/api/workflows');
    const names = (list.body.data as Array<{ name: string }>).map((w) => w.name);
    expect(names).toContain('greet');
  });

  it('PUT /api/workflows/:id returns 400 for invalid YAML content', async () => {
    const wfId = encodeURIComponent('global:bad');
    const res = await request(app).put(`/api/workflows/${wfId}`).send({ yaml: INVALID_YAML });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── delete ──────────────────────────────────────────────────────────────────

  it('DELETE /api/workflows/:id removes the file and the workflow disappears', async () => {
    const wfId = encodeURIComponent('global:simple');
    const res = await request(app).delete(`/api/workflows/${wfId}`);
    expect(res.status).toBe(200);

    const list = await request(app).get('/api/workflows');
    const names = (list.body.data as Array<{ name: string }>).map((w) => w.name);
    expect(names).not.toContain('simple');
  });

  it('DELETE /api/workflows/:id returns 404 for unknown id', async () => {
    const wfId = encodeURIComponent('global:no-such');
    const res = await request(app).delete(`/api/workflows/${wfId}`);
    expect(res.status).toBe(404);
  });

  // ── get source ──────────────────────────────────────────────────────────────

  it('GET /api/workflows/:id returns summary and yaml for a known workflow', async () => {
    const wfId = encodeURIComponent('global:simple');
    const res = await request(app).get(`/api/workflows/${wfId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.summary.name).toBe('simple');
    expect(res.body.data.yaml).toContain('name: simple');
  });

  it('GET /api/workflows/:id returns 404 for unknown workflow', async () => {
    const wfId = encodeURIComponent('global:no-such');
    const res = await request(app).get(`/api/workflows/${wfId}`);
    expect(res.status).toBe(404);
  });
});
