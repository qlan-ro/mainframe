import { describe, it, expect, vi } from 'vitest';
import { suggestionRoutes } from '../../server/routes/suggestions.js';
import type { RouteContext } from '../../server/routes/types.js';

const waitForResponse = (res: any) => vi.waitFor(() => expect(res.json).toHaveBeenCalled(), { timeout: 8000 });
const REAL_GIT_PATH = new URL('../../../../..', import.meta.url).pathname;

function mockRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
}

function createCtx(projectPath: string | null): RouteContext {
  return {
    db: { projects: { get: vi.fn().mockReturnValue(projectPath ? { id: 'p1', name: 'T', path: projectPath } : null) } },
    chats: { getChat: vi.fn().mockReturnValue(null), on: vi.fn() },
    adapters: { get: vi.fn(), list: vi.fn() },
  } as any;
}

function extractHandler(router: any, routePath: string) {
  const layer = router.stack.find((l: any) => l.route?.path === routePath && l.route?.methods.get);
  if (!layer) throw new Error(`No GET handler for ${routePath}`);
  return layer.route.stack[0].handle;
}

const PATH = '/api/projects/:id/suggestions';

describe('GET /api/projects/:id/suggestions', () => {
  it('returns an enveloped Suggestion[] (≤3) for a real repo', async () => {
    const router = suggestionRoutes(createCtx(REAL_GIT_PATH));
    const res = mockRes();
    extractHandler(router, PATH)({ params: { id: 'p1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);
    const result = res.json.mock.calls[0][0] as { success: boolean; data: unknown[] };
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeLessThanOrEqual(3);
  });

  it('returns success:true with [] for a non-git directory', async () => {
    const router = suggestionRoutes(createCtx('/tmp'));
    const res = mockRes();
    extractHandler(router, PATH)({ params: { id: 'p1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('returns 404 when the project is not found', async () => {
    const router = suggestionRoutes(createCtx(null));
    const res = mockRes();
    extractHandler(router, PATH)({ params: { id: 'missing' }, query: {} }, res, vi.fn());
    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(404), { timeout: 2000 });
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Project not found' });
  });
});
