import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { rm } from 'node:fs/promises';
import type { PluginContext } from '@qlan-ro/mainframe-types';
import { activate } from '../index.js';
import { createTestHarness } from './test-setup.js';

let pluginDir: string;
let notify: ReturnType<typeof vi.fn>;
let createChat: ReturnType<typeof vi.fn>;
let ctx: PluginContext;
let app: express.Express;

beforeEach(async () => {
  const harness = await createTestHarness();
  pluginDir = harness.pluginDir;
  notify = harness.notify;
  createChat = harness.createChat;
  ctx = harness.ctx;
  app = harness.app;

  activate(ctx);
});

afterEach(async () => {
  await rm(pluginDir, { recursive: true, force: true });
});

describe('GET /api/plugins/todos/todos', () => {
  it('returns 400 when projectId is missing', async () => {
    const res = await request(app).get('/api/plugins/todos/todos');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'projectId required' });
  });

  it('returns [] for a project with no todos', async () => {
    const res = await request(app).get('/api/plugins/todos/todos').query({ projectId: 'p1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todos: [] });
  });
});

describe('POST /api/plugins/todos/todos', () => {
  it('creates a todo with defaults and assigns number 1', async () => {
    const res = await request(app).post('/api/plugins/todos/todos').send({ projectId: 'p1', title: 'First task' });

    expect(res.status).toBe(201);
    expect(res.body.todo).toMatchObject({
      number: 1,
      project_id: 'p1',
      title: 'First task',
      body: '',
      status: 'open',
      type: 'feature',
      priority: 'medium',
      labels: [],
      assignees: [],
      dependencies: [],
    });
    expect(typeof res.body.todo.id).toBe('string');
  });

  it('increments the per-project todo number', async () => {
    await request(app).post('/api/plugins/todos/todos').send({ projectId: 'p1', title: 'First' });
    const res = await request(app).post('/api/plugins/todos/todos').send({ projectId: 'p1', title: 'Second' });
    expect(res.body.todo.number).toBe(2);
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app).post('/api/plugins/todos/todos').send({ projectId: 'p1' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid input' });
  });

  it('returns 400 for an invalid status enum value', async () => {
    const res = await request(app)
      .post('/api/plugins/todos/todos')
      .send({ projectId: 'p1', title: 'x', status: 'bogus' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid input' });
  });
});

describe('PATCH /api/plugins/todos/todos/:id', () => {
  async function createTodo(): Promise<string> {
    const res = await request(app).post('/api/plugins/todos/todos').send({ projectId: 'p1', title: 'T' });
    return res.body.todo.id as string;
  }

  it('returns 404 for a missing todo', async () => {
    const res = await request(app).patch('/api/plugins/todos/todos/missing').send({ title: 'x' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('updates the title without notifying', async () => {
    const id = await createTodo();
    const res = await request(app).patch(`/api/plugins/todos/todos/${id}`).send({ title: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.todo.title).toBe('Renamed');
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies when status changes', async () => {
    const id = await createTodo();
    const res = await request(app).patch(`/api/plugins/todos/todos/${id}`).send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.todo.status).toBe('in_progress');
    expect(notify).toHaveBeenCalledWith({
      title: `#1 T`,
      body: 'Moved to In Progress',
      level: 'success',
    });
  });
});

describe('PATCH /api/plugins/todos/todos/:id/move', () => {
  it('returns 400 for an invalid status', async () => {
    const res = await request(app).patch('/api/plugins/todos/todos/x/move').send({ status: 'bogus' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid status' });
  });

  it('returns 404 when the todo does not exist', async () => {
    const res = await request(app).patch('/api/plugins/todos/todos/missing/move').send({ status: 'done' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('warns when moved to done with open dependencies', async () => {
    const dep = await request(app).post('/api/plugins/todos/todos').send({ projectId: 'p1', title: 'Dep' });
    const main = await request(app)
      .post('/api/plugins/todos/todos')
      .send({ projectId: 'p1', title: 'Main', dependencies: [dep.body.todo.number] });

    const res = await request(app).patch(`/api/plugins/todos/todos/${main.body.todo.id}/move`).send({ status: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.todo.status).toBe('done');
    expect(notify).toHaveBeenCalledWith({
      title: '#2 Main has open dependencies',
      body: '#1 Dep',
      level: 'warning',
    });
  });
});

describe('DELETE /api/plugins/todos/todos/:id', () => {
  it('deletes and returns 204 with no body', async () => {
    const created = await request(app).post('/api/plugins/todos/todos').send({ projectId: 'p1', title: 'T' });
    const res = await request(app).delete(`/api/plugins/todos/todos/${created.body.todo.id}`);
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});

    const list = await request(app).get('/api/plugins/todos/todos').query({ projectId: 'p1' });
    expect(list.body.todos).toEqual([]);
  });
});

describe('POST /api/plugins/todos/todos/:id/start-session', () => {
  it('returns 404 for a missing todo', async () => {
    const res = await request(app).post('/api/plugins/todos/todos/missing/start-session').send({ projectId: 'p1' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('returns 400 when projectId is missing from the body', async () => {
    const created = await request(app).post('/api/plugins/todos/todos').send({ projectId: 'p1', title: 'T' });
    const res = await request(app).post(`/api/plugins/todos/todos/${created.body.todo.id}/start-session`).send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'projectId required' });
  });

  it('creates a chat and returns chatId + initial message', async () => {
    const created = await request(app)
      .post('/api/plugins/todos/todos')
      .send({ projectId: 'p1', title: 'Ship it', body: 'Do the thing', labels: ['urgent'] });

    const res = await request(app)
      .post(`/api/plugins/todos/todos/${created.body.todo.id}/start-session`)
      .send({ projectId: 'p1' });

    expect(res.status).toBe(200);
    expect(res.body.chatId).toBe('chat-1');
    expect(res.body.initialMessage).toBe(
      '**#1 Ship it**\nType: Feature | Priority: Medium | Labels: urgent\n\n## Description\nDo the thing',
    );
    expect(createChat).toHaveBeenCalledWith({ projectId: 'p1' });
  });
});
