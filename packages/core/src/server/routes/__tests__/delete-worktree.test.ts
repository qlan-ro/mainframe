import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { worktreeRoutes } from '../worktree.js';

vi.mock('../../../workspace/index.js', () => ({
  getWorktrees: vi.fn(),
  removeWorktree: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  realpath: vi.fn((p: string) => Promise.resolve(p)),
}));

import { getWorktrees, removeWorktree } from '../../../workspace/index.js';

const PROJECT_PATH = '/projects/my-repo';
const WORKTREE_PATH = '/projects/my-repo/.worktrees/feat-x';

function makeCtx(projectPath: string | null = PROJECT_PATH) {
  return {
    db: {
      projects: {
        get: vi.fn(() => (projectPath ? { path: projectPath } : null)),
      },
    },
    chats: {
      enableWorktree: vi.fn(),
      disableWorktree: vi.fn(),
      forkToWorktree: vi.fn(),
      attachWorktree: vi.fn(),
      notifyWorktreeDeleted: vi.fn(),
    },
  } as any;
}

function makeApp(ctx = makeCtx()) {
  const app = express();
  app.use(express.json());
  app.use(worktreeRoutes(ctx));
  return app;
}

describe('POST /api/projects/:id/git/delete-worktree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when project is not found', async () => {
    const app = makeApp(makeCtx(null));
    const res = await request(app)
      .post('/api/projects/unknown/git/delete-worktree')
      .send({ worktreePath: WORKTREE_PATH });
    expect(res.status).toBe(404);
  });

  it('returns 400 when worktreePath is missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/projects/proj1/git/delete-worktree').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when worktree is not in the project worktree list', async () => {
    vi.mocked(getWorktrees).mockResolvedValue([{ path: PROJECT_PATH, branch: 'refs/heads/main' }]);
    const app = makeApp();
    const res = await request(app)
      .post('/api/projects/proj1/git/delete-worktree')
      .send({ worktreePath: '/some/other/path' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a registered worktree/i);
  });

  it('returns 400 when trying to delete the main worktree', async () => {
    vi.mocked(getWorktrees).mockResolvedValue([{ path: PROJECT_PATH, branch: 'refs/heads/main' }]);
    const app = makeApp();
    const res = await request(app).post('/api/projects/proj1/git/delete-worktree').send({ worktreePath: PROJECT_PATH });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/main worktree/i);
  });

  it('calls removeWorktree and returns success on valid input', async () => {
    vi.mocked(getWorktrees).mockResolvedValue([
      { path: PROJECT_PATH, branch: 'refs/heads/main' },
      { path: WORKTREE_PATH, branch: 'refs/heads/feat-x' },
    ]);
    vi.mocked(removeWorktree).mockReturnValue(undefined);
    const app = makeApp();
    const res = await request(app)
      .post('/api/projects/proj1/git/delete-worktree')
      .send({ worktreePath: WORKTREE_PATH });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(removeWorktree).toHaveBeenCalledWith(PROJECT_PATH, WORKTREE_PATH, 'feat-x');
  });

  it('notifies chats bound to the deleted worktree on success', async () => {
    vi.mocked(getWorktrees).mockResolvedValue([
      { path: PROJECT_PATH, branch: 'refs/heads/main' },
      { path: WORKTREE_PATH, branch: 'refs/heads/feat-x' },
    ]);
    vi.mocked(removeWorktree).mockReturnValue(undefined);
    const ctx = makeCtx();
    const app = makeApp(ctx);
    const res = await request(app)
      .post('/api/projects/proj1/git/delete-worktree')
      .send({ worktreePath: WORKTREE_PATH });
    expect(res.status).toBe(200);
    expect(ctx.chats.notifyWorktreeDeleted).toHaveBeenCalledWith(WORKTREE_PATH);
  });

  it('uses provided branchName over the one from git worktree list', async () => {
    vi.mocked(getWorktrees).mockResolvedValue([
      { path: PROJECT_PATH, branch: 'refs/heads/main' },
      { path: WORKTREE_PATH, branch: 'refs/heads/feat-x' },
    ]);
    vi.mocked(removeWorktree).mockReturnValue(undefined);
    const app = makeApp();
    const res = await request(app)
      .post('/api/projects/proj1/git/delete-worktree')
      .send({ worktreePath: WORKTREE_PATH, branchName: 'feat-x' });
    expect(res.status).toBe(200);
    expect(removeWorktree).toHaveBeenCalledWith(PROJECT_PATH, WORKTREE_PATH, 'feat-x');
  });
});
