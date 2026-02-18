import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adapterRoutes } from '../../server/routes/adapters.js';
import type { RouteContext } from '../../server/routes/types.js';

function createMockContext(): RouteContext {
  return {
    db: {
      projects: { get: vi.fn() },
      chats: { list: vi.fn() },
      settings: { get: vi.fn() },
    } as any,
    chats: { getChat: vi.fn(), on: vi.fn() } as any,
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

describe('adapterRoutes', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('GET /api/adapters', () => {
    it('returns list of adapters', async () => {
      const adaptersList = [
        { id: 'claude', name: 'Claude', available: true, models: [{ id: 'claude-opus', label: 'Opus' }] },
        { id: 'gemini', name: 'Gemini', available: false, models: [] },
      ];
      (ctx.adapters.list as any).mockResolvedValue(adaptersList);

      const router = adapterRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/adapters');
      const res = mockRes();

      await handler({ params: {}, query: {} }, res, vi.fn());

      expect(ctx.adapters.list).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: adaptersList });
    });

    it('returns empty list when no adapters available', async () => {
      (ctx.adapters.list as any).mockResolvedValue([]);

      const router = adapterRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/adapters');
      const res = mockRes();

      await handler({ params: {}, query: {} }, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });
  });
});
