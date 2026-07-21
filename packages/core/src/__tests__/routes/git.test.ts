import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gitRoutes } from '../../server/routes/git.js';
import type { RouteContext } from '../../server/routes/types.js';

const waitForResponse = (res: any) => vi.waitFor(() => expect(res.json).toHaveBeenCalled(), { timeout: 2000 });

// Uses the actual monorepo as the git project so execGit calls real git
const REAL_GIT_PATH = new URL('../../../../..', import.meta.url).pathname;

// Seeds a temp repo on a known, named branch so the assertion doesn't depend
// on the live monorepo checkout's current branch (flaky under detached HEAD).
function initNamedBranchRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'git-branch-test-'));
  execFileSync('git', ['init', dir], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.com'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'checkout', '-b', 'test-branch'], { stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

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

function createCtxNotFound(): RouteContext {
  return {
    db: {
      projects: {
        get: vi.fn().mockReturnValue(null),
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
  it('returns enveloped branch name for a real git repo', async () => {
    const repoDir = initNamedBranchRepo();
    try {
      const ctx = createCtx(repoDir);
      const router = gitRoutes(ctx);
      const handler = extractHandler(router, 'get', '/api/projects/:id/git/branch');
      const res = mockRes();

      handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
      await waitForResponse(res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: { branch: 'test-branch' } });
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('returns success:true with branch:null for non-git directory', async () => {
    const ctx = createCtx('/tmp');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/branch');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: { branch: null } });
  });

  it('returns success:false with 404 when project not found', async () => {
    const ctx = createCtxNotFound();
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/branch');
    const res = mockRes();

    handler({ params: { id: 'proj-missing' }, query: {} }, res, vi.fn());
    // status is called synchronously for 404
    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(404), { timeout: 2000 });
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Project not found' });
  });
});

describe('GET /api/projects/:id/git/status', () => {
  it('returns enveloped files array for a real git repo', async () => {
    const ctx = createCtx(REAL_GIT_PATH);
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/status');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);

    const result = res.json.mock.calls[0][0] as { success: boolean; data: { files: unknown[] } };
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data.files)).toBe(true);
  });

  it('returns success:true with empty files for non-git directory', async () => {
    const ctx = createCtx('/tmp');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/status');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);

    const result = res.json.mock.calls[0][0] as { success: boolean; data: { files: unknown[]; error: string } };
    expect(result.success).toBe(true);
    expect(result.data.files).toEqual([]);
    expect(typeof result.data.error).toBe('string');
  });
});

describe('GET /api/projects/:id/git/branch-diffs', () => {
  it('returns enveloped branch diff info for a real git repo', async () => {
    const ctx = createCtx(REAL_GIT_PATH);
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/branch-diffs');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);

    const result = res.json.mock.calls[0][0] as {
      success: boolean;
      data: {
        branch: string | null;
        baseBranch: string | null;
        mergeBase: string | null;
        files: unknown[];
      };
    };
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data.files)).toBe(true);
    expect(typeof result.data.branch === 'string' || result.data.branch === null).toBe(true);
  });

  it('returns success:true with empty result for non-git directory', async () => {
    const ctx = createCtx('/tmp');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/branch-diffs');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);

    const result = res.json.mock.calls[0][0] as { success: boolean; data: object };
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ branch: null, baseBranch: null, mergeBase: null, files: [] });
  });
});
