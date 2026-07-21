import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { rm } from 'node:fs/promises';
import type express from 'express';
import type { PluginContext } from '@qlan-ro/mainframe-types';
import { activate } from '../index.js';
import { createTestHarness } from './test-setup.js';

let pluginDir: string;
let ctx: PluginContext;
let app: express.Express;

beforeEach(async () => {
  const harness = await createTestHarness();
  pluginDir = harness.pluginDir;
  ctx = harness.ctx;
  app = harness.app;
});

afterEach(async () => {
  await rm(pluginDir, { recursive: true, force: true });
});

describe('GitHub sync fields: fresh DB', () => {
  it('defaults new columns on a freshly created todo', async () => {
    activate(ctx);
    const res = await request(app).post('/api/plugins/todos/todos').send({ projectId: 'p1', title: 'T' });

    expect(res.status).toBe(201);
    expect(res.body.todo).toMatchObject({
      closed_at: null,
      state_reason: null,
      author: '',
      remote_repo: null,
      remote_number: null,
      remote_url: null,
      synced_at: null,
    });
  });

  it('persists GitHub sync fields sent on create', async () => {
    activate(ctx);
    const res = await request(app).post('/api/plugins/todos/todos').send({
      projectId: 'p1',
      title: 'T',
      state_reason: 'wont_fix',
      author: 'octocat',
      remote_repo: 'acme/widgets',
      remote_number: 42,
      remote_url: 'https://github.com/acme/widgets/issues/42',
      synced_at: '2026-07-18T00:00:00.000Z',
    });

    expect(res.status).toBe(201);
    expect(res.body.todo).toMatchObject({
      state_reason: 'wont_fix',
      author: 'octocat',
      remote_repo: 'acme/widgets',
      remote_number: 42,
      remote_url: 'https://github.com/acme/widgets/issues/42',
      synced_at: '2026-07-18T00:00:00.000Z',
    });
  });
});

describe('GitHub sync fields: legacy DB migration', () => {
  const LEGACY_MIGRATION = `
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL DEFAULT 0,
  project_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  type TEXT NOT NULL DEFAULT 'feature',
  priority TEXT NOT NULL DEFAULT 'medium',
  labels TEXT NOT NULL DEFAULT '[]',
  assignees TEXT NOT NULL DEFAULT '[]',
  milestone TEXT,
  dependencies TEXT NOT NULL DEFAULT '[]',
  order_index REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

  it('adds the new columns and keeps existing rows readable', async () => {
    ctx.db.runMigration(LEGACY_MIGRATION);
    ctx.db
      .prepare(
        `INSERT INTO todos (id,number,project_id,title,body,status,type,priority,labels,assignees,milestone,dependencies,order_index,created_at,updated_at)
         VALUES ('legacy-1',1,'p1','Legacy task','','open','feature','medium','[]','[]',NULL,'[]',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`,
      )
      .run();

    activate(ctx);

    const res = await request(app).get('/api/plugins/todos/todos').query({ projectId: 'p1' });
    expect(res.status).toBe(200);
    expect(res.body.todos).toHaveLength(1);
    expect(res.body.todos[0]).toMatchObject({
      id: 'legacy-1',
      title: 'Legacy task',
      closed_at: null,
      state_reason: null,
      author: '',
      remote_repo: null,
      remote_number: null,
      remote_url: null,
      synced_at: null,
    });
  });
});

describe('PATCH /api/plugins/todos/todos/:id: GitHub sync fields', () => {
  beforeEach(() => {
    activate(ctx);
  });

  async function createTodo(): Promise<string> {
    const res = await request(app).post('/api/plugins/todos/todos').send({ projectId: 'p1', title: 'T' });
    return res.body.todo.id as string;
  }

  it('updates each new field independently', async () => {
    const id = await createTodo();

    const res = await request(app).patch(`/api/plugins/todos/todos/${id}`).send({
      author: 'octocat',
      state_reason: 'duplicate',
      remote_repo: 'acme/widgets',
      remote_number: 7,
      remote_url: 'https://github.com/acme/widgets/issues/7',
      synced_at: '2026-07-18T01:00:00.000Z',
    });

    expect(res.status).toBe(200);
    expect(res.body.todo).toMatchObject({
      author: 'octocat',
      state_reason: 'duplicate',
      remote_repo: 'acme/widgets',
      remote_number: 7,
      remote_url: 'https://github.com/acme/widgets/issues/7',
      synced_at: '2026-07-18T01:00:00.000Z',
    });
  });

  it('sets closed_at when status moves to done, clears it when status leaves done', async () => {
    const id = await createTodo();

    const done = await request(app).patch(`/api/plugins/todos/todos/${id}`).send({ status: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.todo.closed_at).not.toBeNull();

    const reopened = await request(app).patch(`/api/plugins/todos/todos/${id}`).send({ status: 'open' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.todo.closed_at).toBeNull();
  });
});

describe('PATCH /api/plugins/todos/todos/:id/move: closed_at stamping', () => {
  beforeEach(() => {
    activate(ctx);
  });

  it('sets closed_at when moved to done, clears it when moved away from done', async () => {
    const created = await request(app).post('/api/plugins/todos/todos').send({ projectId: 'p1', title: 'T' });
    const id = created.body.todo.id as string;

    const done = await request(app).patch(`/api/plugins/todos/todos/${id}/move`).send({ status: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.todo.closed_at).not.toBeNull();

    const reopened = await request(app).patch(`/api/plugins/todos/todos/${id}/move`).send({ status: 'in_progress' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.todo.closed_at).toBeNull();
  });
});
