import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RouteContext } from '../../server/routes/types.js';

// Mock GitService before importing the routes
const mockSvc = {
  diff: vi.fn(),
  mergeBase: vi.fn(),
  currentBranch: vi.fn(),
  statusRaw: vi.fn(),
  show: vi.fn(),
};

vi.mock('../../git/git-service.js', () => ({
  GitService: { forProject: vi.fn(() => mockSvc) },
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const { gitRoutes } = await import('../../server/routes/git.js');

const waitForResponse = (res: any) => vi.waitFor(() => expect(res.json).toHaveBeenCalled(), { timeout: 2000 });

function mockRes() {
  const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  return res;
}

function createCtx(projectPath: string, worktreePath?: string): RouteContext {
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
    chats: {
      getChat: vi.fn().mockReturnValue(worktreePath ? { worktreePath, worktreeMissing: false } : null),
      on: vi.fn(),
    } as any,
    adapters: { get: vi.fn(), list: vi.fn() } as any,
  };
}

function extractHandler(router: any, method: string, routePath: string) {
  for (const layer of router.stack) {
    if (layer.route?.path === routePath && layer.route?.methods[method]) {
      return layer.route.stack[0].handle;
    }
    if (layer.handle?.stack) {
      for (const inner of layer.handle.stack) {
        if (inner.route?.path === routePath && inner.route?.methods[method]) {
          return inner.route.stack[0].handle;
        }
      }
    }
  }
  throw new Error(`No handler for ${method.toUpperCase()} ${routePath}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/projects/:id/git/diff-since-main', () => {
  it('returns diff for all files since main', async () => {
    const rawDiff = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 line1
+added line
 line2
 line3`;
    mockSvc.mergeBase.mockResolvedValueOnce('abc123');
    mockSvc.diff.mockResolvedValueOnce(rawDiff);

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/diff-since-main');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ diffs: expect.any(Object) }));
  });

  it('uses worktree path when chat has a worktree', async () => {
    mockSvc.mergeBase.mockResolvedValueOnce('abc123');
    mockSvc.diff.mockResolvedValueOnce('');

    const ctx = createCtx('/some/project', '/some/project/.worktrees/feat-x');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/diff-since-main');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: { chatId: 'chat-1' } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ diffs: expect.any(Object) }));
  });

  it('filters to specific files when files array is provided', async () => {
    mockSvc.mergeBase.mockResolvedValueOnce('abc123');
    mockSvc.diff.mockResolvedValueOnce('');

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/diff-since-main');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: { files: ['src/foo.ts'] } }, res, vi.fn());
    await waitForResponse(res);

    expect(mockSvc.diff).toHaveBeenCalledWith(expect.arrayContaining(['--', 'src/foo.ts']));
  });

  it('returns 404 when project not found', async () => {
    const ctx = createCtx('/some/project');
    (ctx.db.projects.get as any).mockReturnValue(null);

    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/diff-since-main');
    const res = mockRes();

    handler({ params: { id: 'missing' }, query: {}, body: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Project not found' });
  });

  it('returns empty diffs when no merge base is found', async () => {
    mockSvc.mergeBase.mockResolvedValue(null);

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/diff-since-main');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith({ diffs: {}, baseBranch: null, mergeBase: null });
  });

  it('returns 400 when git diff fails', async () => {
    mockSvc.mergeBase.mockResolvedValueOnce('abc123');
    mockSvc.diff.mockRejectedValueOnce(new Error('not a git repository'));

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/diff-since-main');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });
});
