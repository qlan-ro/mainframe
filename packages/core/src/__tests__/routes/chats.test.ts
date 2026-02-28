import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatRoutes } from '../../server/routes/chats.js';
import type { RouteContext } from '../../server/routes/types.js';

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

function createMockContext(): RouteContext {
  return {
    db: {
      projects: { get: vi.fn(), list: vi.fn() },
      chats: { list: vi.fn(), getModifiedFilesList: vi.fn() },
      settings: { get: vi.fn() },
    } as any,
    chats: {
      getChat: vi.fn(),
      archiveChat: vi.fn(),
      getMessages: vi.fn(),
      getDisplayMessages: vi.fn(),
      getPendingPermission: vi.fn(),
      on: vi.fn(),
    } as any,
    adapters: { get: vi.fn(), list: vi.fn() } as any,
  };
}

function mockRes() {
  const res: any = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
  return res;
}

function extractHandler(router: any, method: string, routePath: string) {
  const layer = router.stack.find((l: any) => l.route?.path === routePath && l.route?.methods[method]);
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle;
}

describe('chatRoutes', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('GET /api/projects/:projectId/chats', () => {
    it('returns chat list for project', () => {
      const chats = [{ id: 'c1', projectId: 'p1' }];
      (ctx.db.chats.list as any).mockReturnValue(chats);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/projects/:projectId/chats');
      const res = mockRes();

      handler({ params: { projectId: 'p1' }, query: {} }, res, vi.fn());

      expect(ctx.db.chats.list).toHaveBeenCalledWith('p1');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: chats });
    });
  });

  describe('GET /api/chats/:id', () => {
    it('returns chat by id', () => {
      const chat = { id: 'c1', projectId: 'p1', adapter: 'claude' };
      (ctx.chats.getChat as any).mockReturnValue(chat);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:id');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {} }, res, vi.fn());

      expect(ctx.chats.getChat).toHaveBeenCalledWith('c1');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: chat });
    });

    it('returns 404 for unknown chat', () => {
      (ctx.chats.getChat as any).mockReturnValue(undefined);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:id');
      const res = mockRes();

      handler({ params: { id: 'unknown' }, query: {} }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Chat not found' });
    });
  });

  describe('POST /api/chats/:id/archive', () => {
    it('archives chat successfully', async () => {
      (ctx.chats.archiveChat as any).mockResolvedValue(undefined);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/archive');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {}, body: {} }, res, vi.fn());
      await flushPromises();

      expect(ctx.chats.archiveChat).toHaveBeenCalledWith('c1');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('returns 404 when archive fails', async () => {
      (ctx.chats.archiveChat as any).mockRejectedValue(new Error('not found'));

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/archive');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {}, body: {} }, res, vi.fn());
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Operation failed' });
    });
  });

  describe('GET /api/chats/:id/messages', () => {
    it('returns display messages for chat', async () => {
      const messages = [{ id: 'm1', type: 'user', content: [{ type: 'text', text: 'hello' }] }];
      (ctx.chats.getDisplayMessages as any).mockResolvedValue(messages);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:id/messages');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {} }, res, vi.fn());
      await flushPromises();

      expect(ctx.chats.getDisplayMessages).toHaveBeenCalledWith('c1');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: messages });
    });
  });

  describe('GET /api/chats/:id/pending-permission', () => {
    it('returns pending permission', async () => {
      const permission = { toolName: 'write_file', args: {} };
      (ctx.chats.getPendingPermission as any).mockResolvedValue(permission);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:id/pending-permission');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {} }, res, vi.fn());
      await flushPromises();

      expect(ctx.chats.getPendingPermission).toHaveBeenCalledWith('c1');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: permission });
    });

    it('returns null when no pending permission', async () => {
      (ctx.chats.getPendingPermission as any).mockResolvedValue(null);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:id/pending-permission');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {} }, res, vi.fn());
      await flushPromises();

      expect(res.json).toHaveBeenCalledWith({ success: true, data: null });
    });
  });

  describe('GET /api/chats/:id/changes', () => {
    it('returns modified files list', () => {
      const files = ['src/index.ts', 'README.md'];
      (ctx.db.chats.getModifiedFilesList as any).mockReturnValue(files);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:id/changes');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {} }, res, vi.fn());

      expect(ctx.db.chats.getModifiedFilesList).toHaveBeenCalledWith('c1');
      expect(res.json).toHaveBeenCalledWith({ files });
    });
  });
});
