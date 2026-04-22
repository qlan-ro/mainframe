import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatRoutes } from '../../server/routes/chats.js';
import type { RouteContext } from '../../server/routes/types.js';

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

function createMockContext(): RouteContext {
  return {
    db: {
      projects: { get: vi.fn(), list: vi.fn() },
      chats: { list: vi.fn(), update: vi.fn(), get: vi.fn() },
      settings: { get: vi.fn() },
    } as any,
    chats: {
      getChat: vi.fn(),
      listChats: vi.fn(),
      listAllChats: vi.fn(),
      archiveChat: vi.fn(),
      getMessages: vi.fn(),
      getMessagesFromDisk: vi.fn(),
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

  describe('GET /api/chats', () => {
    it('returns all non-archived chats across projects', () => {
      const mockChats = [
        { id: 'c1', projectId: 'p1', title: 'Chat 1', status: 'active' },
        { id: 'c2', projectId: 'p2', title: 'Chat 2', status: 'active' },
      ];
      (ctx.chats.listAllChats as any).mockReturnValue(mockChats);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats');
      const res = mockRes();

      handler({ params: {}, query: {} }, res, vi.fn());

      expect(ctx.chats.listAllChats).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: mockChats });
    });
  });

  describe('GET /api/projects/:projectId/chats', () => {
    it('returns chat list for project', () => {
      const chats = [{ id: 'c1', projectId: 'p1' }];
      (ctx.chats.listChats as any).mockReturnValue(chats);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/projects/:projectId/chats');
      const res = mockRes();

      handler({ params: { projectId: 'p1' }, query: {} }, res, vi.fn());

      expect(ctx.chats.listChats).toHaveBeenCalledWith('p1');
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

      expect(ctx.chats.archiveChat).toHaveBeenCalledWith('c1', true);
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

  describe('PATCH /api/chats/:id/effort', () => {
    it('persists a valid effort level and returns the updated chat', () => {
      const updatedChat = { id: 'c1', projectId: 'p1', adapterId: 'claude', effort: 'high' };
      (ctx.db.chats.update as any).mockImplementation(() => {});
      (ctx.db.chats.get as any).mockReturnValue(updatedChat);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'patch', '/api/chats/:id/effort');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {}, body: { effort: 'high' } }, res, vi.fn());

      expect(ctx.db.chats.update).toHaveBeenCalledWith('c1', { effort: 'high' });
      expect(ctx.db.chats.get).toHaveBeenCalledWith('c1');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: updatedChat });
    });

    it('accepts null to clear effort', () => {
      const updatedChat = { id: 'c1', projectId: 'p1', adapterId: 'claude' };
      (ctx.db.chats.update as any).mockImplementation(() => {});
      (ctx.db.chats.get as any).mockReturnValue(updatedChat);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'patch', '/api/chats/:id/effort');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {}, body: { effort: null } }, res, vi.fn());

      expect(ctx.db.chats.update).toHaveBeenCalledWith('c1', { effort: null });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: updatedChat });
    });

    it('rejects invalid effort values with 400', () => {
      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'patch', '/api/chats/:id/effort');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {}, body: { effort: 'max' } }, res, vi.fn());

      expect(ctx.db.chats.update).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects missing effort field with 400', () => {
      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'patch', '/api/chats/:id/effort');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {}, body: {} }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when chat does not exist after update', () => {
      (ctx.db.chats.update as any).mockImplementation(() => {});
      (ctx.db.chats.get as any).mockReturnValue(null);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'patch', '/api/chats/:id/effort');
      const res = mockRes();

      handler({ params: { id: 'unknown' }, query: {}, body: { effort: 'low' } }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('GET /api/chats/:id/session-files', () => {
    it('returns session file paths from message history', async () => {
      const messages = [
        {
          id: 'm1',
          chatId: 'c1',
          type: 'assistant',
          content: [{ type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: 'src/index.ts' } }],
          timestamp: new Date().toISOString(),
        },
      ];
      (ctx.chats.getMessagesFromDisk as any).mockResolvedValue(messages);

      const router = chatRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:id/session-files');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {} }, res, vi.fn());
      await flushPromises();

      expect(ctx.chats.getMessagesFromDisk).toHaveBeenCalledWith('c1');
      expect(res.json).toHaveBeenCalledWith({ files: ['src/index.ts'] });
    });
  });
});
