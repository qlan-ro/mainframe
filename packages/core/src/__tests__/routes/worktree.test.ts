import { describe, it, expect, vi, beforeEach } from 'vitest';
import { worktreeRoutes } from '../../server/routes/worktree.js';
import type { RouteContext } from '../../server/routes/types.js';

function createMockContext(): RouteContext {
  return {
    db: {
      projects: { get: vi.fn(), list: vi.fn() },
      chats: { list: vi.fn() },
      settings: { get: vi.fn() },
    } as any,
    chats: {
      enableWorktree: vi.fn(),
      disableWorktree: vi.fn(),
      forkToWorktree: vi.fn(),
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

describe('worktreeRoutes', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
    vi.clearAllMocks();
  });

  describe('POST /api/chats/:id/enable-worktree', () => {
    it('returns 200 with valid body', async () => {
      (ctx.chats.enableWorktree as any).mockResolvedValueOnce(undefined);

      const router = worktreeRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/enable-worktree');
      const res = mockRes();

      await handler(
        { params: { id: 'chat-1' }, body: { baseBranch: 'main', branchName: 'feature/my-branch' } },
        res,
        vi.fn(),
      );

      expect(ctx.chats.enableWorktree).toHaveBeenCalledWith('chat-1', 'main', 'feature/my-branch');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('returns 400 for invalid branch name with special chars', async () => {
      const router = worktreeRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/enable-worktree');
      const res = mockRes();

      await handler(
        { params: { id: 'chat-1' }, body: { baseBranch: 'main', branchName: 'invalid branch!' } },
        res,
        vi.fn(),
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
      expect(ctx.chats.enableWorktree).not.toHaveBeenCalled();
    });

    it('returns 400 for branch name containing ".."', async () => {
      const router = worktreeRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/enable-worktree');
      const res = mockRes();

      await handler({ params: { id: 'chat-1' }, body: { baseBranch: 'main', branchName: 'feat..evil' } }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
      expect(ctx.chats.enableWorktree).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/chats/:id/disable-worktree', () => {
    it('returns 200', async () => {
      (ctx.chats.disableWorktree as any).mockResolvedValueOnce(undefined);

      const router = worktreeRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/disable-worktree');
      const res = mockRes();

      await handler({ params: { id: 'chat-1' }, body: {} }, res, vi.fn());

      expect(ctx.chats.disableWorktree).toHaveBeenCalledWith('chat-1');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('POST /api/chats/:id/fork-worktree', () => {
    it('returns 200 with chatId on success', async () => {
      (ctx.chats.forkToWorktree as any).mockResolvedValueOnce({ chatId: 'new-chat-42' });

      const router = worktreeRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/fork-worktree');
      const res = mockRes();

      await handler(
        { params: { id: 'chat-1' }, body: { baseBranch: 'main', branchName: 'session/abc123' } },
        res,
        vi.fn(),
      );

      expect(ctx.chats.forkToWorktree).toHaveBeenCalledWith('chat-1', 'main', 'session/abc123');
      expect(res.json).toHaveBeenCalledWith({ success: true, chatId: 'new-chat-42' });
    });

    it('returns 409 when repo is dirty', async () => {
      const err = Object.assign(new Error('Working tree has uncommitted changes'), { statusCode: 409 });
      (ctx.chats.forkToWorktree as any).mockRejectedValueOnce(err);

      const router = worktreeRoutes(ctx);
      const handler = extractHandler(router, 'post', '/api/chats/:id/fork-worktree');
      const res = mockRes();

      await handler(
        { params: { id: 'chat-1' }, body: { baseBranch: 'main', branchName: 'session/abc123' } },
        res,
        vi.fn(),
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: 'Working tree has uncommitted changes' });
    });
  });
});
