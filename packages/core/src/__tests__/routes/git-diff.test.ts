import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RouteContext } from '../../server/routes/types.js';

// Mock GitService before importing the routes
const mockSvc = {
  diff: vi.fn(),
  mergeBase: vi.fn(),
  detectBaseBranch: vi.fn(),
  currentBranch: vi.fn(),
  statusRaw: vi.fn(),
  show: vi.fn(),
  stage: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
};

vi.mock('../../git/git-service.js', () => ({
  GitService: { forProject: vi.fn(() => mockSvc) },
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('../../server/routes/path-utils.js', () => ({
  resolveAndValidatePath: vi.fn((base: string, p: string) => `${base}/${p}`),
  resolveClaudeConfigPath: vi.fn(),
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
      getEffectivePath: vi.fn().mockReturnValue(projectPath),
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

describe('GET /api/projects/:id/git/diff', () => {
  it('returns diff for a valid git source query', async () => {
    mockSvc.diff.mockResolvedValueOnce('diff output');
    mockSvc.show.mockResolvedValueOnce('original content');
    const { readFile } = await import('node:fs/promises');
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce('modified content');

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/diff');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { source: 'git', file: 'src/foo.ts' } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ diff: 'diff output', source: 'git' }),
    });
  });

  it('returns 400 when source is not "git"', async () => {
    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'get', '/api/projects/:id/git/diff');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: { source: 'svn' } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('POST /api/projects/:id/git/diff-since-main', () => {
  it('returns { main, worktree } shape for each changed file', async () => {
    const { readFile } = await import('node:fs/promises');
    const nameStatusOutput = 'M\tsrc/foo.ts';
    mockSvc.detectBaseBranch.mockResolvedValueOnce({ baseBranch: 'main', mergeBase: 'abc123' });
    mockSvc.diff.mockResolvedValueOnce(nameStatusOutput);
    mockSvc.show.mockResolvedValueOnce('original content');
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce('modified content');

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/diff-since-main');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          baseBranch: 'main',
          mergeBase: 'abc123',
          diffs: {
            'src/foo.ts': { main: 'original content', worktree: 'modified content' },
          },
        }),
      }),
    );
  });

  it('returns empty main for added files', async () => {
    const { readFile } = await import('node:fs/promises');
    mockSvc.detectBaseBranch.mockResolvedValueOnce({ baseBranch: 'main', mergeBase: 'abc123' });
    mockSvc.diff.mockResolvedValueOnce('A\tsrc/new.ts');
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce('new file content');

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/diff-since-main');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          diffs: { 'src/new.ts': { main: '', worktree: 'new file content' } },
        }),
      }),
    );
    expect(mockSvc.show).not.toHaveBeenCalled();
  });

  it('returns empty worktree for deleted files', async () => {
    mockSvc.detectBaseBranch.mockResolvedValueOnce({ baseBranch: 'main', mergeBase: 'abc123' });
    mockSvc.diff.mockResolvedValueOnce('D\tsrc/gone.ts');
    mockSvc.show.mockResolvedValueOnce('old content');

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/diff-since-main');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          diffs: { 'src/gone.ts': { main: 'old content', worktree: '' } },
        }),
      }),
    );
  });

  it('uses worktree path when chat has a worktree', async () => {
    mockSvc.detectBaseBranch.mockResolvedValueOnce({ baseBranch: 'main', mergeBase: 'abc123' });
    mockSvc.diff.mockResolvedValueOnce('');

    const ctx = createCtx('/some/project', '/some/project/.worktrees/feat-x');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/diff-since-main');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: { chatId: 'chat-1' } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ diffs: expect.any(Object), baseBranch: 'main', mergeBase: 'abc123' }),
      }),
    );
  });

  it('filters to specific files when files array is provided', async () => {
    mockSvc.detectBaseBranch.mockResolvedValueOnce({ baseBranch: 'main', mergeBase: 'abc123' });
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
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Project not found' });
  });

  it('returns empty diffs when no merge base is found', async () => {
    mockSvc.detectBaseBranch.mockResolvedValue(null);

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/projects/:id/git/diff-since-main');
    const res = mockRes();

    handler({ params: { id: 'proj-1' }, query: {}, body: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: { diffs: {}, baseBranch: null, mergeBase: null } });
  });

  it('returns 400 when git diff fails', async () => {
    mockSvc.detectBaseBranch.mockResolvedValueOnce({ baseBranch: 'main', mergeBase: 'abc123' });
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

describe('POST /api/git/stage', () => {
  it('stages specified files', async () => {
    mockSvc.stage.mockResolvedValueOnce(undefined);

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/stage');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { chatId: 'chat-123', files: ['src/index.ts'] } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(mockSvc.stage).toHaveBeenCalledWith(['src/index.ts']);
  });

  it('returns success for empty files array', async () => {
    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/stage');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { chatId: 'chat-123', files: [] } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('returns 404 for nonexistent chat', async () => {
    const ctx = createCtx('/some/project');
    (ctx.chats.getEffectivePath as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/stage');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { chatId: 'nonexistent', files: ['src/index.ts'] } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Chat not found' });
  });

  it('returns 400 for git error', async () => {
    mockSvc.stage.mockRejectedValueOnce(new Error('pathspec did not match any files'));

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/stage');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { chatId: 'chat-123', files: ['nonexistent-file.ts'] } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 400 when chatId is missing', async () => {
    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/stage');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { files: ['src/index.ts'] } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('POST /api/git/commit', () => {
  it('stages files and creates a commit, returning hash', async () => {
    mockSvc.stage.mockResolvedValueOnce(undefined);
    mockSvc.commit.mockResolvedValueOnce('abc1234');

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/commit');
    const res = mockRes();

    handler(
      { params: {}, query: {}, body: { chatId: 'chat-123', message: 'feat: add button', files: ['src/button.tsx'] } },
      res,
      vi.fn(),
    );
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: { hash: 'abc1234' } });
    expect(mockSvc.stage).toHaveBeenCalledWith(['src/button.tsx']);
    expect(mockSvc.commit).toHaveBeenCalledWith('feat: add button');
  });

  it('rejects empty commit message', async () => {
    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/commit');
    const res = mockRes();

    handler(
      { params: {}, query: {}, body: { chatId: 'chat-123', message: '', files: ['src/button.tsx'] } },
      res,
      vi.fn(),
    );
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 for nonexistent chat', async () => {
    const ctx = createCtx('/some/project');
    (ctx.chats.getEffectivePath as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/commit');
    const res = mockRes();

    handler(
      { params: {}, query: {}, body: { chatId: 'nonexistent', message: 'test', files: ['src/file.ts'] } },
      res,
      vi.fn(),
    );
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Chat not found' });
  });

  it('skips staging when files array is empty', async () => {
    mockSvc.commit.mockResolvedValueOnce('def5678');

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/commit');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { chatId: 'chat-123', message: 'test commit', files: [] } }, res, vi.fn());
    await waitForResponse(res);

    expect(mockSvc.stage).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { hash: 'def5678' } });
  });

  it('returns 400 when git commit fails', async () => {
    mockSvc.stage.mockResolvedValueOnce(undefined);
    mockSvc.commit.mockRejectedValueOnce(new Error('nothing to commit'));

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/commit');
    const res = mockRes();

    handler(
      { params: {}, query: {}, body: { chatId: 'chat-123', message: 'test', files: ['src/file.ts'] } },
      res,
      vi.fn(),
    );
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });
});

describe('POST /api/git/push', () => {
  it('pushes current branch to origin', async () => {
    mockSvc.push.mockResolvedValueOnce({ status: 'success', branch: 'feat/my-branch', remote: 'origin' });

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/push');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { chatId: 'chat-123' } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(mockSvc.push).toHaveBeenCalled();
  });

  it('returns 404 for nonexistent chat', async () => {
    const ctx = createCtx('/some/project');
    (ctx.chats.getEffectivePath as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/push');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { chatId: 'nonexistent' } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Chat not found' });
  });

  it('returns 400 on push rejection (non-fast-forward)', async () => {
    mockSvc.push.mockResolvedValueOnce({ status: 'rejected', message: 'non-fast-forward' });

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/push');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { chatId: 'chat-123' } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('returns 400 on push error (network, auth, etc)', async () => {
    mockSvc.push.mockRejectedValueOnce(new Error('Authentication failed'));

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/push');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { chatId: 'chat-123' } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('rejects request with missing chatId', async () => {
    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/push');
    const res = mockRes();

    handler({ params: {}, query: {}, body: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('POST /api/git/status', () => {
  it('returns staged, unstaged, and untracked files', async () => {
    mockSvc.statusRaw.mockResolvedValueOnce('M  src/foo.ts\n?? src/new.ts\n');

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/status');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { chatId: 'chat-123' } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).not.toHaveBeenCalledWith(expect.any(Number));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          staged: expect.any(Array),
          unstaged: expect.any(Array),
          untracked: expect.any(Array),
        }),
      }),
    );
  });

  it('parses git status output correctly', async () => {
    // M in index = staged, space in working tree = not unstaged
    // space in index = not staged, M in working tree = unstaged
    // ?? = untracked
    mockSvc.statusRaw.mockResolvedValueOnce('M  src/staged.ts\n M src/unstaged.ts\n?? src/new.ts\n');

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/status');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { chatId: 'chat-123' } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        staged: ['src/staged.ts'],
        unstaged: ['src/unstaged.ts'],
        untracked: ['src/new.ts'],
      },
    });
  });

  it('returns 404 for nonexistent chat', async () => {
    const ctx = createCtx('/some/project');
    (ctx.chats.getEffectivePath as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/status');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { chatId: 'nonexistent-chat' } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Chat not found' });
  });

  it('returns 400 when chatId is missing', async () => {
    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/status');
    const res = mockRes();

    handler({ params: {}, query: {}, body: {} }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('returns 400 when git status fails', async () => {
    mockSvc.statusRaw.mockRejectedValueOnce(new Error('not a git repository'));

    const ctx = createCtx('/some/project');
    const router = gitRoutes(ctx);
    const handler = extractHandler(router, 'post', '/api/git/status');
    const res = mockRes();

    handler({ params: {}, query: {}, body: { chatId: 'chat-123' } }, res, vi.fn());
    await waitForResponse(res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });
});
