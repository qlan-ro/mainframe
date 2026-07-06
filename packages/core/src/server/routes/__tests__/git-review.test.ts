/**
 * Route tests for the Review modal data layer:
 *  - POST /api/projects/:id/git/commit  (git-write.ts)
 *  - GET  /api/projects/:id/git/working-stat  (git.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { gitWriteRoutes } from '../git-write.js';
import { gitRoutes } from '../git.js';
import type { RouteContext } from '../types.js';
import type { GitService } from '../../../git/git-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(projectPath: string | null = '/tmp/project'): RouteContext {
  return {
    db: {
      projects: {
        get: (id: string) => (projectPath !== null && id === 'proj-1' ? { path: projectPath } : null),
      },
    },
    chats: {
      getChat: () => null,
      getEffectivePath: () => null,
    },
  } as unknown as RouteContext;
}

function makeWriteApp(ctx = makeCtx()) {
  const app = express();
  app.use(express.json());
  app.use(gitWriteRoutes(ctx));
  return app;
}

function makeReadApp(ctx = makeCtx()) {
  const app = express();
  app.use(express.json());
  app.use(gitRoutes(ctx));
  return app;
}

// ---------------------------------------------------------------------------
// POST /api/projects/:id/git/commit
// ---------------------------------------------------------------------------

describe('POST /api/projects/:id/git/commit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 404 when project is not found', async () => {
    const app = makeWriteApp(makeCtx(null));
    const res = await request(app).post('/api/projects/proj-1/git/commit').send({ message: 'feat: something' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false });
  });

  it('returns 400 when message is empty', async () => {
    const app = makeWriteApp();
    const res = await request(app).post('/api/projects/proj-1/git/commit').send({ message: '' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
  });

  it('returns 400 when message is missing', async () => {
    const app = makeWriteApp();
    const res = await request(app).post('/api/projects/proj-1/git/commit').send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
  });

  it('returns { success: true, data: { commit } } on success', async () => {
    // We mock the GitService so we don't need a real git repo here
    const { GitService } = await import('../../../git/git-service.js');
    vi.spyOn(GitService, 'forProject').mockReturnValue({
      commitAll: vi.fn().mockResolvedValue('abc123'),
    } as unknown as GitService);

    const app = makeWriteApp();
    const res = await request(app).post('/api/projects/proj-1/git/commit').send({ message: 'feat: add something' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { commit: 'abc123' } });
  });

  it('returns 500 when commitAll throws', async () => {
    const { GitService } = await import('../../../git/git-service.js');
    vi.spyOn(GitService, 'forProject').mockReturnValue({
      commitAll: vi.fn().mockRejectedValue(new Error('Nothing to commit')),
    } as unknown as GitService);

    const app = makeWriteApp();
    const res = await request(app).post('/api/projects/proj-1/git/commit').send({ message: 'feat: something' });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, error: 'Nothing to commit' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/git/working-stat
// ---------------------------------------------------------------------------

describe('GET /api/projects/:id/git/working-stat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 404 when project is not found', async () => {
    const app = makeReadApp(makeCtx(null));
    const res = await request(app).get('/api/projects/proj-1/git/working-stat');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false });
  });

  it('returns stat data on success', async () => {
    const { GitService } = await import('../../../git/git-service.js');
    const mockStat = {
      files: [{ path: 'src/foo.ts', additions: 5, deletions: 2 }],
      totalAdditions: 5,
      totalDeletions: 2,
    };
    vi.spyOn(GitService, 'forProject').mockReturnValue({
      workingStat: vi.fn().mockResolvedValue(mockStat),
    } as unknown as GitService);

    const app = makeReadApp();
    const res = await request(app).get('/api/projects/proj-1/git/working-stat');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: mockStat });
  });

  it('returns 500 when workingStat throws', async () => {
    const { GitService } = await import('../../../git/git-service.js');
    vi.spyOn(GitService, 'forProject').mockReturnValue({
      workingStat: vi.fn().mockRejectedValue(new Error('git error')),
    } as unknown as GitService);

    const app = makeReadApp();
    const res = await request(app).get('/api/projects/proj-1/git/working-stat');

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false });
  });
});
