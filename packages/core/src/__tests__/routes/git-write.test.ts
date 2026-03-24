import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RouteContext } from '../../server/routes/types.js';

// Mock GitService before importing the routes
const mockSvc = {
  branches: vi.fn(),
  checkout: vi.fn(),
  createBranch: vi.fn(),
  fetch: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  merge: vi.fn(),
  rebase: vi.fn(),
  abort: vi.fn(),
  renameBranch: vi.fn(),
  deleteBranch: vi.fn(),
  updateAll: vi.fn(),
};

vi.mock('../../git/git-service.js', () => ({
  GitService: { forProject: vi.fn(() => mockSvc) },
}));

const { gitRoutes } = await import('../../server/routes/git.js');

const waitForResponse = (res: any) => vi.waitFor(() => expect(res.json).toHaveBeenCalled(), { timeout: 2000 });

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
  for (const layer of router.stack) {
    // Direct route match
    if (layer.route?.path === routePath && layer.route?.methods[method]) {
      return layer.route.stack[0].handle;
    }
    // Nested router (from router.use)
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

describe('GET /api/projects/:id/git/branches', () => {
  it('returns branch list from svc.branches()', async () => {
    const branchResult = {
      current: 'main',
      local: [{ name: 'main', current: true }],
      remote: ['origin/main'],
    };
    mockSvc.branches.mockResolvedValueOnce(branchResult);

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/branches');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(mockSvc.branches).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith(branchResult);
  });

  it('returns 404 when project not found', async () => {
    const ctx = createCtx('/some/project');
    (ctx.db.projects.get as any).mockReturnValue(null);
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/branches');
    const res = mockRes();

    handler({ params: { id: 'missing' }, query: {}, body: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Project not found' });
  });
});

describe('POST /api/projects/:id/git/checkout', () => {
  it('calls svc.checkout and returns ok', async () => {
    mockSvc.checkout.mockResolvedValueOnce(undefined);

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/checkout');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: { branch: 'feature/foo' } }, res, vi.fn());
    await waitForResponse(res);

    expect(mockSvc.checkout).toHaveBeenCalledWith('feature/foo');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('returns 400 when branch is missing', async () => {
    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/checkout');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSvc.checkout).not.toHaveBeenCalled();
  });
});

describe('POST /api/projects/:id/git/merge', () => {
  it('returns success result', async () => {
    const mergeResult = { status: 'success', summary: { commits: 1, insertions: 5, deletions: 2 } };
    mockSvc.merge.mockResolvedValueOnce(mergeResult);

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/merge');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: { branch: 'feature/foo' } }, res, vi.fn());
    await waitForResponse(res);

    expect(mockSvc.merge).toHaveBeenCalledWith('feature/foo');
    expect(res.json).toHaveBeenCalledWith(mergeResult);
  });

  it('returns conflict result', async () => {
    const conflictResult = { status: 'conflict', conflicts: ['src/index.ts'], message: 'Merge conflict' };
    mockSvc.merge.mockResolvedValueOnce(conflictResult);

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/merge');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: { branch: 'feature/conflicting' } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith(conflictResult);
  });
});

describe('POST /api/projects/:id/git/delete-branch', () => {
  it('returns not-merged result when branch is not fully merged', async () => {
    const notMergedResult = { status: 'not-merged', message: 'Branch is not fully merged' };
    mockSvc.deleteBranch.mockResolvedValueOnce(notMergedResult);

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/delete-branch');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: { name: 'feature/unmerged' } }, res, vi.fn());
    await waitForResponse(res);

    expect(mockSvc.deleteBranch).toHaveBeenCalledWith('feature/unmerged', undefined);
    expect(res.json).toHaveBeenCalledWith(notMergedResult);
  });

  it('calls deleteBranch with force=true when specified', async () => {
    mockSvc.deleteBranch.mockResolvedValueOnce({ status: 'success' });

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/delete-branch');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: { name: 'feature/old', force: true } }, res, vi.fn());
    await waitForResponse(res);

    expect(mockSvc.deleteBranch).toHaveBeenCalledWith('feature/old', true);
    expect(res.json).toHaveBeenCalledWith({ status: 'success' });
  });
});
