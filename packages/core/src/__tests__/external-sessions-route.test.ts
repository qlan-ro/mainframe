import { describe, it, expect, vi, beforeEach } from 'vitest';
import { externalSessionRoutes } from '../server/routes/external-sessions.js';
import type { RouteContext } from '../server/routes/types.js';

function createMockContext(): RouteContext {
  const scanPage = vi.fn().mockResolvedValue({ sessions: [], total: 0, nextOffset: null });
  const startAutoScan = vi.fn();
  const importSession = vi.fn();

  return {
    db: {} as any,
    chats: {
      getExternalSessionService: vi.fn().mockReturnValue({ scanPage, startAutoScan, importSession }),
    } as any,
    adapters: {} as any,
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

describe('externalSessionRoutes', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('GET /api/projects/:projectId/external-sessions', () => {
    it('defaults to offset=0 and limit=50 when no query params', async () => {
      const router = externalSessionRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/projects/:projectId/external-sessions');
      const res = mockRes();

      await handler({ params: { projectId: 'proj-1' }, query: {} }, res, vi.fn());

      const service = ctx.chats.getExternalSessionService();
      expect(service.scanPage).toHaveBeenCalledWith('proj-1', 0, 50);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { sessions: [], total: 0, nextOffset: null } });
    });

    it('forwards explicit offset and limit to scanPage', async () => {
      const router = externalSessionRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/projects/:projectId/external-sessions');
      const res = mockRes();

      await handler({ params: { projectId: 'proj-2' }, query: { offset: '2', limit: '10' } }, res, vi.fn());

      const service = ctx.chats.getExternalSessionService();
      expect(service.scanPage).toHaveBeenCalledWith('proj-2', 2, 10);
    });

    it('returns 400 and does not call scanPage for invalid limit=-1', async () => {
      const router = externalSessionRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/projects/:projectId/external-sessions');
      const res = mockRes();

      await handler({ params: { projectId: 'proj-3' }, query: { limit: '-1' } }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Invalid query params' });
      const service = ctx.chats.getExternalSessionService();
      expect(service.scanPage).not.toHaveBeenCalled();
    });
  });
});
