import { describe, it, expect, vi } from 'vitest';
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

function mockRes() {
  const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  return res;
}

function handlerFor(router: any, method: string, path: string) {
  const l = router.stack.find((x: any) => x.route?.path === path && x.route?.methods[method]);
  if (!l) throw new Error(`No handler for ${method.toUpperCase()} ${path}`);
  return l.route.stack[l.route.stack.length - 1].handle;
}

describe('chatCommandRoutes', () => {
  // POST /api/chats
  it('POST /api/chats creates and returns the chat enveloped', async () => {
    const ctx = ctxWith();
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'post', '/api/chats')(
      { params: {}, body: { projectId: 'p1', adapterId: 'claude' } },
      res,
      vi.fn(),
    );
    expect(ctx.chats.createChatWithDefaults).toHaveBeenCalledWith(
      'p1',
      'claude',
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'c1', projectId: 'p1', title: 'T' } });
  });

  it('POST /api/chats rejects invalid body with 400', async () => {
    const ctx = ctxWith();
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'post', '/api/chats')({ params: {}, body: {} }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('POST /api/chats rejects mismatched worktreePath/branchName with 400', async () => {
    const ctx = ctxWith();
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'post', '/api/chats')(
      { params: {}, body: { projectId: 'p1', adapterId: 'claude', worktreePath: '/some/path' } },
      res,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  // PATCH /api/chats/:id/config
  it('PATCH /api/chats/:id/config returns updated chat', async () => {
    const ctx = ctxWith();
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'patch', '/api/chats/:id/config')(
      { params: { id: 'c1' }, body: {} },
      res,
      vi.fn(),
    );
    expect(ctx.chats.updateChatConfig).toHaveBeenCalledWith('c1', undefined, undefined, undefined, undefined);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'c1', projectId: 'p1', title: 'T2' } });
  });

  it('PATCH /api/chats/:id/config returns 404 for unknown chat', async () => {
    const ctx = ctxWith({ getChat: vi.fn().mockReturnValue(null) });
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'patch', '/api/chats/:id/config')(
      { params: { id: 'nope' }, body: {} },
      res,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  // POST /api/chats/:id/interrupt
  it('POST /api/chats/:id/interrupt → okEmpty', async () => {
    const ctx = ctxWith();
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'post', '/api/chats/:id/interrupt')(
      { params: { id: 'c1' }, body: {} },
      res,
      vi.fn(),
    );
    expect(ctx.chats.interruptChat).toHaveBeenCalledWith('c1');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('POST /api/chats/:id/interrupt returns 404 for unknown chat', async () => {
    const ctx = ctxWith({ getChat: vi.fn().mockReturnValue(null) });
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'post', '/api/chats/:id/interrupt')(
      { params: { id: 'nope' }, body: {} },
      res,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  // POST /api/chats/:id/resume
  it('POST /api/chats/:id/resume → okEmpty', async () => {
    const ctx = ctxWith();
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'post', '/api/chats/:id/resume')(
      { params: { id: 'c1' }, body: {} },
      res,
      vi.fn(),
    );
    expect(ctx.chats.resumeChat).toHaveBeenCalledWith('c1');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  // POST /api/chats/:id/trust-workspace
  it('POST /api/chats/:id/trust-workspace → okEmpty', async () => {
    const ctx = ctxWith();
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'post', '/api/chats/:id/trust-workspace')(
      { params: { id: 'c1' }, body: {} },
      res,
      vi.fn(),
    );
    expect(ctx.chats.trustWorkspace).toHaveBeenCalledWith('c1');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('POST /api/chats/:id/trust-workspace returns 404 for unknown chat', async () => {
    const ctx = ctxWith({ getChat: vi.fn().mockReturnValue(null) });
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'post', '/api/chats/:id/trust-workspace')(
      { params: { id: 'nope' }, body: {} },
      res,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  // PATCH /api/chats/:id/queue/:messageId
  it('PATCH /api/chats/:id/queue/:messageId edits queued message', async () => {
    const ctx = ctxWith();
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'patch', '/api/chats/:id/queue/:messageId')(
      { params: { id: 'c1', messageId: 'm1' }, body: { content: 'new text' } },
      res,
      vi.fn(),
    );
    expect(ctx.chats.editQueuedMessage).toHaveBeenCalledWith('c1', 'm1', 'new text');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('PATCH /api/chats/:id/queue/:messageId returns 400 on bad body', async () => {
    const ctx = ctxWith();
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'patch', '/api/chats/:id/queue/:messageId')(
      { params: { id: 'c1', messageId: 'm1' }, body: {} },
      res,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('PATCH /api/chats/:id/queue/:messageId returns 400 on empty content', async () => {
    const ctx = ctxWith();
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'patch', '/api/chats/:id/queue/:messageId')(
      { params: { id: 'c1', messageId: 'm1' }, body: { content: '' } },
      res,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  // DELETE /api/chats/:id/queue/:messageId
  it('DELETE /api/chats/:id/queue/:messageId cancels queued message', async () => {
    const ctx = ctxWith();
    const res = mockRes();
    await handlerFor(chatCommandRoutes(ctx), 'delete', '/api/chats/:id/queue/:messageId')(
      { params: { id: 'c1', messageId: 'm1' }, body: {} },
      res,
      vi.fn(),
    );
    expect(ctx.chats.cancelQueuedMessage).toHaveBeenCalledWith('c1', 'm1');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
