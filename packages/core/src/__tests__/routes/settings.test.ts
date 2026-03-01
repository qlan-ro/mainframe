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

describe('settingRoutes', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('GET /api/settings/providers', () => {
    it('returns grouped provider settings', () => {
      (ctx.db.settings.getByCategory as any).mockReturnValue({
        'claude.defaultModel': 'opus',
        'claude.defaultMode': 'normal',
        'gemini.defaultModel': 'pro',
      });

      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/settings/providers');
      const res = mockRes();

      handler({ params: {}, query: {} }, res, vi.fn());

      expect(ctx.db.settings.getByCategory).toHaveBeenCalledWith('provider');
      const call = res.json.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.claude).toEqual({ defaultModel: 'opus', defaultMode: 'normal' });
      expect(call.data.gemini).toEqual({ defaultModel: 'pro' });
    });

    it('maps legacy skipPermissions to defaultMode yolo', () => {
      (ctx.db.settings.getByCategory as any).mockReturnValue({
        'claude.skipPermissions': 'true',
      });

      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/settings/providers');
      const res = mockRes();

      handler({ params: {}, query: {} }, res, vi.fn());

      const call = res.json.mock.calls[0][0];
      expect(call.data.claude.defaultMode).toBe('yolo');
      expect(call.data.claude.skipPermissions).toBeUndefined();
    });

    it('does not override existing defaultMode with skipPermissions', () => {
      (ctx.db.settings.getByCategory as any).mockReturnValue({
        'claude.skipPermissions': 'true',
        'claude.defaultMode': 'plan',
      });

      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/settings/providers');
      const res = mockRes();

      handler({ params: {}, query: {} }, res, vi.fn());

      const call = res.json.mock.calls[0][0];
      expect(call.data.claude.defaultMode).toBe('plan');
    });

    it('skips keys without a dot separator', () => {
      (ctx.db.settings.getByCategory as any).mockReturnValue({
        noDotsHere: 'value',
        'claude.model': 'opus',
      });

      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/settings/providers');
      const res = mockRes();

      handler({ params: {}, query: {} }, res, vi.fn());

      const call = res.json.mock.calls[0][0];
      expect(call.data.noDotsHere).toBeUndefined();
      expect(call.data.claude).toEqual({ model: 'opus' });
    });
  });

  describe('PUT /api/settings/providers/:adapterId', () => {
    it('sets defaultModel', () => {
      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/settings/providers/:adapterId');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: {}, body: { defaultModel: 'sonnet' } }, res, vi.fn());

      expect(ctx.db.settings.set).toHaveBeenCalledWith('provider', 'claude.defaultModel', 'sonnet');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('deletes defaultModel when value is falsy', () => {
      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/settings/providers/:adapterId');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: {}, body: { defaultModel: '' } }, res, vi.fn());

      expect(ctx.db.settings.delete).toHaveBeenCalledWith('provider', 'claude.defaultModel');
      expect(ctx.db.settings.set).not.toHaveBeenCalled();
    });

    it('sets defaultMode and cleans up skipPermissions', () => {
      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/settings/providers/:adapterId');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: {}, body: { defaultMode: 'yolo' } }, res, vi.fn());

      expect(ctx.db.settings.set).toHaveBeenCalledWith('provider', 'claude.defaultMode', 'yolo');
      expect(ctx.db.settings.delete).toHaveBeenCalledWith('provider', 'claude.skipPermissions');
    });

    it('sets planExecutionMode', () => {
      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/settings/providers/:adapterId');
      const res = mockRes();

      handler({ params: { adapterId: 'gemini' }, query: {}, body: { planExecutionMode: 'auto' } }, res, vi.fn());

      expect(ctx.db.settings.set).toHaveBeenCalledWith('provider', 'gemini.planExecutionMode', 'auto');
    });

    it('sets executablePath', () => {
      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/settings/providers/:adapterId');
      const res = mockRes();

      handler(
        { params: { adapterId: 'claude' }, query: {}, body: { executablePath: '/usr/local/bin/claude' } },
        res,
        vi.fn(),
      );

      expect(ctx.db.settings.set).toHaveBeenCalledWith('provider', 'claude.executablePath', '/usr/local/bin/claude');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('deletes executablePath when empty', () => {
      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/settings/providers/:adapterId');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: {}, body: { executablePath: '' } }, res, vi.fn());

      expect(ctx.db.settings.delete).toHaveBeenCalledWith('provider', 'claude.executablePath');
    });

    it('ignores undefined fields', () => {
      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/settings/providers/:adapterId');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: {}, body: {} }, res, vi.fn());

      expect(ctx.db.settings.set).not.toHaveBeenCalled();
      expect(ctx.db.settings.delete).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('GET /api/adapters/:adapterId/config-conflicts', () => {
    it('returns empty conflicts for non-claude adapters', () => {
      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/adapters/:adapterId/config-conflicts');
      const res = mockRes();

      handler({ params: { adapterId: 'gemini' }, query: {} }, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({ success: true, data: { conflicts: [] } });
    });
  });
});
