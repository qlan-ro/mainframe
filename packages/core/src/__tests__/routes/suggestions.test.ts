import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { suggestionRoutes } from '../../server/routes/suggestions.js';
import type { RouteContext } from '../../server/routes/types.js';

const waitForResponse = (res: any) => vi.waitFor(() => expect(res.json).toHaveBeenCalled(), { timeout: 8000 });

function mockRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
}

function initGitRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'suggestions-test-'));
  execFileSync('git', ['init', dir], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.com'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'], { stdio: 'pipe' });
  writeFileSync(path.join(dir, 'file.txt'), 'hello\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  return dir;
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
  let repoDir: string;

  beforeEach(() => {
    repoDir = initGitRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns a churn suggestion for a repo with uncommitted changes', async () => {
    writeFileSync(path.join(repoDir, 'file.txt'), 'hello\nmodified\n');

    const router = suggestionRoutes(createCtx(repoDir));
    const res = mockRes();
    extractHandler(router, PATH)({ params: { id: 'p1' }, query: {} }, res, vi.fn());
    await waitForResponse(res);
    const result = res.json.mock.calls[0][0] as { success: boolean; data: unknown[] };
    expect(result).toEqual({
      success: true,
      data: [
        {
          icon: 'git-compare',
          tint: 'accent',
          title: 'Review the working changes',
          meta: 'git · 1 file uncommitted',
          prefill:
            'Review the uncommitted changes in the working tree, summarize what they do, and flag anything unsafe to commit.',
        },
      ],
    });
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
