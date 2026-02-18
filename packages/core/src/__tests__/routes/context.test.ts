import { describe, it, expect, vi, beforeEach } from 'vitest';
import { contextRoutes } from '../../server/routes/context.js';
import type { RouteContext } from '../../server/routes/types.js';

function createMockContext(): RouteContext {
  return {
    db: {
      projects: { get: vi.fn() },
      chats: { list: vi.fn() },
      settings: { get: vi.fn() },
    } as any,
    chats: {
      getChat: vi.fn(),
      getSessionContext: vi.fn(),
      addMention: vi.fn(),
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

describe('contextRoutes', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('GET /api/chats/:id/context', () => {
    it('returns session context', async () => {
      const chat = { id: 'c1', projectId: 'p1', worktreePath: null };
      const project = { id: 'p1', path: '/proj' };
      const context = { files: [], mentions: [] };

      (ctx.chats.getChat as any).mockReturnValue(chat);
      (ctx.db.projects.get as any).mockReturnValue(project);
      (ctx.chats.getSessionContext as any).mockResolvedValue(context);

      const router = contextRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:id/context');
      const res = mockRes();

      await handler({ params: { id: 'c1' }, query: {} }, res, vi.fn());

      expect(ctx.chats.getSessionContext).toHaveBeenCalledWith('c1', '/proj');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: context });
    });

    it('uses worktreePath when available', async () => {
      const chat = { id: 'c1', projectId: 'p1', worktreePath: '/worktree' };
      const project = { id: 'p1', path: '/proj' };

      (ctx.chats.getChat as any).mockReturnValue(chat);
      (ctx.db.projects.get as any).mockReturnValue(project);
      (ctx.chats.getSessionContext as any).mockResolvedValue({});

      const router = contextRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:id/context');
      const res = mockRes();

      await handler({ params: { id: 'c1' }, query: {} }, res, vi.fn());

      expect(ctx.chats.getSessionContext).toHaveBeenCalledWith('c1', '/worktree');
    });

    it('returns 404 when chat not found', async () => {
      (ctx.chats.getChat as any).mockReturnValue(undefined);

      const router = contextRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:id/context');
      const res = mockRes();

      await handler({ params: { id: 'nope' }, query: {} }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Chat not found' });
    });

    it('returns 404 when project not found', async () => {
      const chat = { id: 'c1', projectId: 'p1' };
      (ctx.chats.getChat as any).mockReturnValue(chat);
      (ctx.db.projects.get as any).mockReturnValue(undefined);

      const router = contextRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/chats/:id/context');
      const res = mockRes();

      await handler({ params: { id: 'c1' }, query: {} }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Project not found' });
    });
  });

  describe('POST /api/chats/:id/mentions', () => {
    it('adds a mention', () => {
      const router = contextRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/mentions');
      const res = mockRes();

      handler(
        {
          params: { id: 'c1' },
          query: {},
          body: { kind: 'file', name: 'index.ts', path: 'src/index.ts' },
        },
        res,
        vi.fn(),
      );

      expect(ctx.chats.addMention).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({
          kind: 'file',
          name: 'index.ts',
          path: 'src/index.ts',
          source: 'user',
        }),
      );
      const data = res.json.mock.calls[0][0].data;
      expect(data.id).toBeDefined();
      expect(data.timestamp).toBeDefined();
    });

    it('returns 400 when kind missing', () => {
      const router = contextRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/mentions');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {}, body: { name: 'index.ts' } }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns 400 when name missing', () => {
      const router = contextRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/mentions');
      const res = mockRes();

      handler({ params: { id: 'c1' }, query: {}, body: { kind: 'file' } }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
