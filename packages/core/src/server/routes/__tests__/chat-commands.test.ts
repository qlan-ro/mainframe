import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { chatCommandRoutes } from '../chat-commands.js';
import type { RouteContext } from '../types.js';

function ctxWith(over: Partial<RouteContext['chats']> = {}): RouteContext {
  return {
    db: { projects: { get: vi.fn() }, chats: {}, settings: { get: vi.fn() } } as any,
    chats: {
      createChatWithDefaults: vi.fn().mockResolvedValue({ id: 'c1', projectId: 'p1', title: 'T' }),
      updateChatConfig: vi.fn().mockResolvedValue(undefined),
      getChat: vi.fn().mockReturnValue({ id: 'c1', projectId: 'p1', title: 'T2' }),
      interruptChat: vi.fn().mockResolvedValue(undefined),
      resumeChat: vi.fn().mockResolvedValue(undefined),
      trustWorkspace: vi.fn().mockResolvedValue(undefined),
      editQueuedMessage: vi.fn().mockResolvedValue(undefined),
      cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
      ...over,
    } as any,
    adapters: { get: vi.fn(), list: vi.fn() } as any,
  };
}

function makeApp(ctx: RouteContext) {
  const app = express();
  app.use(express.json());
  app.use(chatCommandRoutes(ctx));
  return app;
}

type Method = 'post' | 'patch' | 'delete';

describe('chatCommandRoutes', () => {
  it('POST /api/chats creates and returns the chat enveloped', async () => {
    const ctx = ctxWith();
    const res = await request(makeApp(ctx)).post('/api/chats').send({ projectId: 'p1', adapterId: 'claude' });

    expect(ctx.chats.createChatWithDefaults).toHaveBeenCalledWith(
      'p1',
      'claude',
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: 'c1', projectId: 'p1', title: 'T' } });
  });

  it.each([
    ['invalid body', {}],
    [
      'mismatched worktreePath without branchName',
      { projectId: 'p1', adapterId: 'claude', worktreePath: '/some/path' },
    ],
  ])('POST /api/chats rejects %s with 400', async (_label, body) => {
    const res = await request(makeApp(ctxWith())).post('/api/chats').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
  });

  it('PATCH /api/chats/:id/config returns updated chat', async () => {
    const ctx = ctxWith();
    const res = await request(makeApp(ctx)).patch('/api/chats/c1/config').send({});

    expect(ctx.chats.updateChatConfig).toHaveBeenCalledWith('c1', undefined, undefined, undefined, undefined);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: 'c1', projectId: 'p1', title: 'T2' } });
  });

  it.each([
    ['post', '/api/chats/c1/interrupt', {}, 'interruptChat', ['c1']],
    ['post', '/api/chats/c1/resume', {}, 'resumeChat', ['c1']],
    ['post', '/api/chats/c1/trust-workspace', {}, 'trustWorkspace', ['c1']],
    ['patch', '/api/chats/c1/queue/m1', { content: 'new text' }, 'editQueuedMessage', ['c1', 'm1', 'new text']],
    ['delete', '/api/chats/c1/queue/m1', {}, 'cancelQueuedMessage', ['c1', 'm1']],
  ] as [Method, string, object, string, unknown[]][])(
    '%s %s → okEmpty and delegates to the service',
    async (method, path, body, service, args) => {
      const ctx = ctxWith();
      const res = await request(makeApp(ctx))[method](path).send(body);

      expect((ctx.chats as any)[service]).toHaveBeenCalledWith(...args);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    },
  );

  it.each([
    ['patch', '/api/chats/nope/config', {}],
    ['post', '/api/chats/nope/interrupt', {}],
    ['post', '/api/chats/nope/resume', {}],
    ['post', '/api/chats/nope/trust-workspace', {}],
    ['patch', '/api/chats/nope/queue/m1', { content: 'x' }],
    ['delete', '/api/chats/nope/queue/m1', {}],
  ] as [Method, string, object][])('%s %s returns 404 for an unknown chat', async (method, path, body) => {
    const ctx = ctxWith({ getChat: vi.fn().mockReturnValue(null) });
    const res = await request(makeApp(ctx))[method](path).send(body);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false });
  });

  it.each([
    ['missing content', {}],
    ['empty content', { content: '' }],
  ])('PATCH /api/chats/:id/queue/:messageId returns 400 on %s', async (_label, body) => {
    const res = await request(makeApp(ctxWith())).patch('/api/chats/c1/queue/m1').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
  });
});
