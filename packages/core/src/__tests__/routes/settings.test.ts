import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub out executable resolution so GET /api/settings/providers tests don't
// spawn real child processes and hit unpredictable timeouts.
vi.mock('../../adapters/resolve-executable.js', () => ({
  resolveAdapterExecutable: vi.fn().mockResolvedValue({ path: 'claude', source: 'fallback', valid: false }),
  resolveAdapterExecutableCached: vi.fn().mockResolvedValue({ path: 'claude', source: 'fallback', valid: false }),
  clearResolveMemo: () => {},
  defaultRun: vi.fn(),
  BARE_NAMES: { claude: 'claude', codex: 'codex', gemini: 'gemini', opencode: 'opencode' },
}));

import { settingRoutes } from '../../server/routes/settings.js';
import { resolveAdapterExecutableCached } from '../../adapters/resolve-executable.js';
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
    adapters: {
      get: vi.fn(),
      list: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
      getSnapshots: vi.fn().mockReturnValue([]),
    } as any,
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
    (resolveAdapterExecutableCached as any).mockResolvedValue({ path: 'claude', source: 'fallback', valid: false });
  });

  describe('GET /api/settings/providers', () => {
    it('returns grouped provider settings', async () => {
      (ctx.db.settings.getByCategory as any).mockReturnValue({
        'claude.defaultModel': 'opus',
        'claude.defaultMode': 'normal',
        'gemini.defaultModel': 'pro',
      });

      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/settings/providers');
      const res = mockRes();

      await handler({ params: {}, query: {} }, res, vi.fn());

      expect(ctx.db.settings.getByCategory).toHaveBeenCalledWith('provider');
      const call = res.json.mock.calls[0][0];
      expect(call.success).toBe(true);
      // resolvedExecutable is now added per adapter; use toMatchObject to tolerate the new key
      expect(call.data.claude).toMatchObject({ defaultModel: 'opus', defaultMode: 'normal' });
      expect(call.data.gemini).toMatchObject({ defaultModel: 'pro' });
    });

    it('omits a saved default model absent from a non-empty catalog', async () => {
      (ctx.db.settings.getByCategory as any).mockReturnValue({
        'claude.defaultModel': 'opus',
      });
      (ctx.adapters.getSnapshots as any).mockReturnValue([
        {
          id: 'claude',
          models: [
            { id: 'default', label: 'Default - Opus 4.8', isDefault: true },
            { id: 'sonnet', label: 'Sonnet 5' },
          ],
        },
      ]);

      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/settings/providers');
      const res = mockRes();

      await handler({ params: {}, query: {} }, res, vi.fn());

      expect(res.json.mock.calls[0][0].data.claude.defaultModel).toBeUndefined();
    });

    it('maps legacy skipPermissions to defaultMode yolo', async () => {
      (ctx.db.settings.getByCategory as any).mockReturnValue({
        'claude.skipPermissions': 'true',
      });

      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/settings/providers');
      const res = mockRes();

      await handler({ params: {}, query: {} }, res, vi.fn());

      const call = res.json.mock.calls[0][0];
      expect(call.data.claude.defaultMode).toBe('yolo');
      expect(call.data.claude.skipPermissions).toBeUndefined();
    });

    it('does not override existing defaultMode with skipPermissions', async () => {
      (ctx.db.settings.getByCategory as any).mockReturnValue({
        'claude.skipPermissions': 'true',
        'claude.defaultMode': 'default',
        'claude.defaultPlanMode': 'true',
      });

      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/settings/providers');
      const res = mockRes();

      await handler({ params: {}, query: {} }, res, vi.fn());

      const call = res.json.mock.calls[0][0];
      expect(call.data.claude.defaultMode).toBe('default');
      expect(call.data.claude.defaultPlanMode).toBe('true');
    });

    it('skips keys without a dot separator', async () => {
      (ctx.db.settings.getByCategory as any).mockReturnValue({
        noDotsHere: 'value',
        'claude.model': 'opus',
      });

      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/settings/providers');
      const res = mockRes();

      await handler({ params: {}, query: {} }, res, vi.fn());

      const call = res.json.mock.calls[0][0];
      expect(call.data.noDotsHere).toBeUndefined();
      // resolvedExecutable is now added per adapter; use toMatchObject to tolerate the new key
      expect(call.data.claude).toMatchObject({ model: 'opus' });
    });

    it('includes a resolved executable for every registered adapter', async () => {
      (ctx.db.settings.getByCategory as any).mockReturnValue({});
      (ctx.adapters.getAll as any).mockReturnValue([{ id: 'claude' }, { id: 'codex' }]);
      (resolveAdapterExecutableCached as any).mockImplementation(async (id: string) => ({
        path: `/usr/local/bin/${id}`,
        source: 'detected',
        valid: true,
      }));

      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/settings/providers');
      const res = mockRes();
      await handler({ params: {}, query: {} }, res, vi.fn());

      const { data } = res.json.mock.calls[0][0];
      expect(data.claude.resolvedExecutable).toMatchObject({ path: '/usr/local/bin/claude', valid: true });
      expect(data.codex.resolvedExecutable).toMatchObject({ path: '/usr/local/bin/codex', valid: true });
    });

    it('still enriches stored settings for an adapter that is no longer registered', async () => {
      (ctx.db.settings.getByCategory as any).mockReturnValue({ 'ghost.defaultModel': 'gpt-ghost' });
      (ctx.adapters.getAll as any).mockReturnValue([{ id: 'claude' }]);

      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/settings/providers');
      const res = mockRes();
      await handler({ params: {}, query: {} }, res, vi.fn());

      const { data } = res.json.mock.calls[0][0];
      expect(data.ghost).toMatchObject({ defaultModel: 'gpt-ghost' });
      expect(data.ghost.resolvedExecutable).toBeDefined();
    });
  });

  describe('PUT /api/settings/providers/:adapterId', () => {
    // setAssert/deleteAssert/checkJson mirror exactly what each original test
    // asserted — some checked only the positive set/delete call, some also
    // asserted the other was never called, some checked res.json, some didn't.
    it.each([
      {
        label: 'sets defaultModel',
        body: { defaultModel: 'sonnet' },
        setAssert: ['claude.defaultModel', 'sonnet'] as const,
        deleteAssert: undefined,
        checkJson: true,
      },
      {
        label: 'deletes defaultModel when value is falsy',
        body: { defaultModel: '' },
        setAssert: 'not-called' as const,
        deleteAssert: 'claude.defaultModel',
        checkJson: false,
      },
      {
        label: 'sets defaultMode and cleans up skipPermissions',
        body: { defaultMode: 'yolo' },
        setAssert: ['claude.defaultMode', 'yolo'] as const,
        deleteAssert: 'claude.skipPermissions',
        checkJson: false,
      },
      {
        label: 'sets defaultPlanMode',
        body: { defaultPlanMode: 'true' },
        setAssert: ['claude.defaultPlanMode', 'true'] as const,
        deleteAssert: undefined,
        checkJson: true,
      },
      {
        label: 'sets executablePath',
        body: { executablePath: '/usr/local/bin/claude' },
        setAssert: ['claude.executablePath', '/usr/local/bin/claude'] as const,
        deleteAssert: undefined,
        checkJson: true,
      },
      {
        label: 'deletes executablePath when empty',
        body: { executablePath: '' },
        setAssert: undefined,
        deleteAssert: 'claude.executablePath',
        checkJson: false,
      },
      {
        label: 'ignores undefined fields',
        body: {},
        setAssert: 'not-called' as const,
        deleteAssert: 'not-called' as const,
        checkJson: true,
      },
    ])('$label', ({ body, setAssert, deleteAssert, checkJson }) => {
      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/settings/providers/:adapterId');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: {}, body }, res, vi.fn());

      if (setAssert === 'not-called') {
        expect(ctx.db.settings.set).not.toHaveBeenCalled();
      } else if (setAssert) {
        expect(ctx.db.settings.set).toHaveBeenCalledWith('provider', ...setAssert);
      }

      if (deleteAssert === 'not-called') {
        expect(ctx.db.settings.delete).not.toHaveBeenCalled();
      } else if (deleteAssert) {
        expect(ctx.db.settings.delete).toHaveBeenCalledWith('provider', deleteAssert);
      }

      if (checkJson) {
        expect(res.json).toHaveBeenCalledWith({ success: true });
      }
    });

    it.each([
      ['defaultMode', 'bogus-mode'],
      ['defaultEffort', 'ultra'],
    ])('rejects invalid %s enum value with 400', (field, value) => {
      const router = settingRoutes(ctx);
      const handler = extractHandler(router, 'put', '/api/settings/providers/:adapterId');
      const res = mockRes();

      handler({ params: { adapterId: 'claude' }, query: {}, body: { [field]: value } }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(ctx.db.settings.set).not.toHaveBeenCalled();
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
