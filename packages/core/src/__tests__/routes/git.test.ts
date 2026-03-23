import { describe, it, expect, vi } from 'vitest';
import { gitRoutes } from '../../server/routes/git.js';
import type { RouteContext } from '../../server/routes/types.js';

const waitForResponse = (res: any) => vi.waitFor(() => expect(res.json).toHaveBeenCalled(), { timeout: 2000 });

// Uses the actual monorepo as the git project so execGit calls real git
const REAL_GIT_PATH = new URL('../../../../..', import.meta.url).pathname;

function mockRes() {
  const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  return res;
}

function createCtx(projectPath: string): RouteContext {
  return {
    db: {
      projects: {
        get: vi.fn().mockReturnValue({ id: 'proj-1', name: 'Test', path: projectPath }),
      },
      chats: {
        list: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue(null),
      },
      settings: { get: vi.fn().mockReturnValue(null) },
    } as any,
    chats: { getChat: vi.fn().mockReturnValue(null), on: vi.fn() } as any,
    adapters: { get: vi.fn(), list: vi.fn() } as any,
  };
}

function extractHandler(router: any, method: string, routePath: string) {
  const layer = router.stack.find((l: any) => l.route?.path === routePath && l.route?.methods[method]);
  if (!layer) throw new Error(`No handler for ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle;
}

describe('GET /api/projects/:id/git/branch', () => {
  it('returns a branch name for a real git repo', async () => {
    const ctx = createCtx(REAL_GIT_PATH);
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/branch');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);

    const result = res.json.mock.calls[0][0] as { branch: string | null };
    expect(typeof result.branch).toBe('string');
    expect(result.branch!.length).toBeGreaterThan(0);
  });

  it('returns { branch: null } for non-git directory', async () => {
    const ctx = createCtx('/tmp');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/branch');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith({ branch: null });
  });
});

describe('GET /api/projects/:id/git/status', () => {
  it('returns files array for a real git repo', async () => {
    const ctx = createCtx(REAL_GIT_PATH);
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/status');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);

    const result = res.json.mock.calls[0][0] as { files: unknown[] };
    expect(Array.isArray(result.files)).toBe(true);
  });

  it('returns { files: [], error } for non-git directory', async () => {
    const ctx = createCtx('/tmp');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/status');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ files: [], error: expect.any(String) }));
  });
});

describe('GET /api/projects/:id/branch-diffs', () => {
  it('returns branch diff info for a real git repo', async () => {
    const ctx = createCtx(REAL_GIT_PATH);
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/branch-diffs');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);

    const result = res.json.mock.calls[0][0] as {
      branch: string | null;
      baseBranch: string | null;
      mergeBase: string | null;
      files: unknown[];
    };
    expect(Array.isArray(result.files)).toBe(true);
    expect(typeof result.branch === 'string' || result.branch === null).toBe(true);
  });

  it('returns empty result for non-git directory', async () => {
    const ctx = createCtx('/tmp');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/branch-diffs');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ branch: null, baseBranch: null, mergeBase: null, files: [] }),
    );
  });
});
