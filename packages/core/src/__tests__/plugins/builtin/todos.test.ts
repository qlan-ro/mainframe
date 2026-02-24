import { describe, it, expect, afterEach, vi } from 'vitest';
import { activate } from '../../../plugins/builtin/todos/index.js';
import { buildPluginContext, type PluginContextDeps } from '../../../plugins/context.js';
import { EventEmitter } from 'node:events';
import { Router } from 'express';
import { pino } from 'pino';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginManifest } from '@mainframe/types';
import request from 'supertest';
import express from 'express';

const todosManifest: PluginManifest = {
  id: 'todos',
  name: 'TODO Kanban',
  version: '1.0.0',
  capabilities: ['storage', 'chat:create', 'ui:panels'],
};

let tmpDir: string;

function makeApp() {
  tmpDir = mkdtempSync(join(tmpdir(), 'mf-todos-test-'));
  const router = Router();
  const app = express();
  app.use(express.json());

  const emitEvent = vi.fn();
  const deps: PluginContextDeps = {
    manifest: todosManifest,
    pluginDir: tmpDir,
    router,
    logger: pino({ level: 'silent' }),
    daemonBus: new EventEmitter(),
    db: {
      chats: {
        create: vi.fn().mockReturnValue({
          id: 'chat-1',
          adapterId: 'claude',
          projectId: 'proj-1',
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          totalCost: 0,
          totalTokensInput: 0,
          totalTokensOutput: 0,
          lastContextTokensInput: 0,
        }),
        get: vi.fn().mockReturnValue(null),
        list: vi.fn().mockReturnValue([]),
      },
      projects: {
        list: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue(null),
      },
      settings: {
        get: vi.fn().mockReturnValue(null),
        set: vi.fn(),
      },
    } as unknown as PluginContextDeps['db'],
    adapters: { register: vi.fn() } as unknown as PluginContextDeps['adapters'],
    emitEvent,
    onUnloadCallbacks: [],
  };

  const ctx = buildPluginContext(deps);
  activate(ctx);
  app.use('/', router);
  return { app, emitEvent };
}

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('todos plugin routes', () => {
  it('GET /todos returns empty list initially', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/todos');
    expect(res.status).toBe(200);
    expect(res.body.todos).toEqual([]);
  });

  it('POST /todos creates a todo', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/todos').send({ title: 'Fix login bug', type: 'bug' });
    expect(res.status).toBe(201);
    expect(res.body.todo.title).toBe('Fix login bug');
    expect(res.body.todo.type).toBe('bug');
    expect(res.body.todo.status).toBe('open');
    expect(res.body.todo.id).toBeDefined();
  });

  it('PATCH /todos/:id/move changes status', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/todos').send({ title: 'Test' });
    const id = create.body.todo.id as string;
    const res = await request(app).patch(`/todos/${id}/move`).send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.todo.status).toBe('in_progress');
  });

  it('DELETE /todos/:id removes a todo', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/todos').send({ title: 'Delete me' });
    const id = create.body.todo.id as string;
    await request(app).delete(`/todos/${id}`);
    const list = await request(app).get('/todos');
    expect(list.body.todos).toHaveLength(0);
  });

  it('POST /todos/:id/start-session creates a chat and emits event', async () => {
    const { app, emitEvent } = makeApp();
    const create = await request(app).post('/todos').send({ title: 'Big feature' });
    const id = create.body.todo.id as string;
    const res = await request(app).post(`/todos/${id}/start-session`).send({ projectId: 'proj-1' });
    expect(res.status).toBe(200);
    expect(res.body.chatId).toBe('chat-1');
    expect(res.body.initialMessage).toContain('Big feature');
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.created' }));
  });
});
