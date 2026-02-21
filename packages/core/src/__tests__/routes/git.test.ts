import { describe, it, expect, vi } from 'vitest';
import { gitRoutes } from '../../server/routes/git.js';
import type { RouteContext } from '../../server/routes/types.js';

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 50));

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
        getModifiedFilesList: vi.fn().mockReturnValue([]),
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
    await flushPromises();

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
    await flushPromises();

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
    await flushPromises();

    const result = res.json.mock.calls[0][0] as { files: unknown[] };
    expect(Array.isArray(result.files)).toBe(true);
  });

  it('returns { files: [], error } for non-git directory', async () => {
    const ctx = createCtx('/tmp');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/status');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ files: [], error: expect.any(String) }));
  });
});

describe('GET /api/projects/:id/diff?source=session (no file)', () => {
  it('returns modified files list from DB', async () => {
    const ctx = createCtx(REAL_GIT_PATH);
    (ctx.db.chats as any).getModifiedFilesList = vi.fn().mockReturnValue(['src/main.ts', 'lib/utils.ts']);

    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/diff');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { source: 'session', chatId: 'chat-1' } }, res, vi.fn());
    await flushPromises();

    expect(res.json).toHaveBeenCalledWith({
      files: ['src/main.ts', 'lib/utils.ts'],
      source: 'session',
    });
  });
});
