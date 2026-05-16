import { describe, it, expect, vi, beforeEach } from 'vitest';
import { settingRoutes } from '../../server/routes/settings.js';
import type { RouteContext } from '../../server/routes/types.js';

function createMockContext(): RouteContext {
  return {
    db: {
      projects: { get: vi.fn() },
      chats: { list: vi.fn() },
      settings: {
        get: vi.fn(),
        getByCategory: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
      },
    } as any,
    chats: { getChat: vi.fn(), on: vi.fn() } as any,
    adapters: { get: vi.fn(), list: vi.fn(), getAll: vi.fn() } as any,
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

describe('GET /api/settings/providers - resolvedExecutable', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
    // No registered adapters by default
    (ctx.adapters.getAll as any).mockReturnValue([]);
  });

  it('includes resolvedExecutable with source="config" when executablePath is configured', async () => {
    // Stub settings: claude has a configured executablePath
    (ctx.db.settings.getByCategory as any).mockReturnValue({
      'claude.executablePath': '/custom/claude',
    });
    // settings.get is called by resolveAdapterExecutable to read provider.<id>.executablePath
    (ctx.db.settings.get as any).mockImplementation((category: string, key: string) => {
      if (category === 'provider' && key === 'claude.executablePath') return '/custom/claude';
      return null;
    });

    const router = settingRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/settings/providers');
    const res = mockRes();
    const next = vi.fn();

    await handler({ params: {}, query: {} }, res, next);

    expect(next).not.toHaveBeenCalled();
    const call = res.json.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.claude.resolvedExecutable).toBeDefined();
    expect(call.data.claude.resolvedExecutable.source).toBe('config');
  });

  it('includes resolvedExecutable with source="fallback" when detection fails', async () => {
    // No provider settings stored; registry returns an adapter whose binary cannot be found
    (ctx.db.settings.getByCategory as any).mockReturnValue({});
    (ctx.db.settings.get as any).mockReturnValue(null);
    // Registry surfaces the unknown adapter id so it appears in the union
    (ctx.adapters.getAll as any).mockReturnValue([{ id: 'definitely-not-real-xyz' }]);

    const router = settingRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/settings/providers');
    const res = mockRes();
    const next = vi.fn();

    await handler({ params: {}, query: {} }, res, next);

    expect(next).not.toHaveBeenCalled();
    const call = res.json.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data['definitely-not-real-xyz'].resolvedExecutable).toBeDefined();
    expect(call.data['definitely-not-real-xyz'].resolvedExecutable.source).toBe('fallback');
  });
});
