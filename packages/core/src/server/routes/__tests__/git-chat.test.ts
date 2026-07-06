import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { gitChatRoutes } from '../git-chat.js';
import { gitRoutes } from '../git.js';
import type { RouteContext } from '../types.js';
import type { Chat } from '@qlan-ro/mainframe-types';

// Minimal chat fixture
function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    ...overrides,
  };
}

/**
 * Build a minimal RouteContext for git-chat routes.
 * `getEffectivePath` is the ChatManager method (no projectId param).
 * `getChat` returns the chat or null.
 * `db.projects.get` returns the project or null.
 */
function makeCtx(opts: { chat?: Chat | null; projectPath?: string | null }): RouteContext {
  const { chat = null, projectPath = '/tmp/project' } = opts;

  return {
    db: {
      projects: {
        get: (id: string) =>
          projectPath !== null && id === (chat?.projectId ?? 'proj-1') ? { path: projectPath } : null,
      },
    },
    chats: {
      getChat: (_chatId: string) => chat,
      getEffectivePath: (chatId: string) => {
        if (!chat || chat.id !== chatId) return null;
        if (chat.worktreePath) {
          if (chat.worktreeMissing) return null;
          return chat.worktreePath;
        }
        return projectPath ?? null;
      },
    },
  } as unknown as RouteContext;
}

// ──────────────────────────────────────────────
// chatRoute (POST /api/git/status|stage|unstage|commit|push)
// ──────────────────────────────────────────────
describe('chatRoute — worktree-missing guard (F2)', () => {
  it('returns 409 Worktree missing when the chat worktree has been deleted', async () => {
    const chat = makeChat({
      worktreePath: '/tmp/gone-worktree',
      worktreeMissing: true,
    });
    const app = express();
    app.use(express.json());
    app.use(gitChatRoutes(makeCtx({ chat })));

    const res = await request(app).post('/api/git/status').send({ chatId: 'chat-1' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: 'Worktree missing' });
  });

  it('returns 404 Chat not found when the chatId is unknown', async () => {
    const app = express();
    app.use(express.json());
    app.use(gitChatRoutes(makeCtx({ chat: null })));

    const res = await request(app).post('/api/git/status').send({ chatId: 'does-not-exist' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Chat not found' });
  });

  it('returns 409 on POST /api/git/stage when worktree is missing', async () => {
    const chat = makeChat({
      worktreePath: '/tmp/gone-worktree',
      worktreeMissing: true,
    });
    const app = express();
    app.use(express.json());
    app.use(gitChatRoutes(makeCtx({ chat })));

    const res = await request(app)
      .post('/api/git/stage')
      .send({ chatId: 'chat-1', files: ['foo.ts'] });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: 'Worktree missing' });
  });

  it('returns 409 on POST /api/git/commit when worktree is missing', async () => {
    const chat = makeChat({
      worktreePath: '/tmp/gone-worktree',
      worktreeMissing: true,
    });
    const app = express();
    app.use(express.json());
    app.use(gitChatRoutes(makeCtx({ chat })));

    const res = await request(app).post('/api/git/commit').send({ chatId: 'chat-1', message: 'fix: thing', files: [] });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: 'Worktree missing' });
  });
});

// ──────────────────────────────────────────────
// getEffectivePath — cross-project guard (F3)
// accessed via diff-since-main (POST /api/projects/:id/git/diff-since-main)
// ──────────────────────────────────────────────
describe('diff-since-main — cross-project guard (F3)', () => {
  function makeGitApp(chat: Chat | null, projectPath: string | null = '/tmp/proj') {
    const app = express();
    app.use(express.json());
    // gitRoutes mounts gitChatRoutes which contains diff-since-main
    app.use(gitRoutes(makeCtx({ chat, projectPath })));
    return app;
  }

  it('returns 404 when chatId belongs to a different project', async () => {
    // Chat belongs to proj-2, but the URL says proj-1
    const chat = makeChat({ id: 'chat-x', projectId: 'proj-2' });

    // Rebuild ctx so db.projects.get returns the proj-1 project (not proj-2's)
    const ctx: RouteContext = {
      db: {
        projects: {
          get: (id: string) => (id === 'proj-1' ? { path: '/tmp/proj-1' } : null),
        },
      },
      chats: {
        getChat: (_chatId: string) => chat,
        getEffectivePath: (_chatId: string) => null, // unused in this route
      },
    } as unknown as RouteContext;

    const app = express();
    app.use(express.json());
    app.use(gitRoutes(ctx));

    const res = await request(app).post('/api/projects/proj-1/git/diff-since-main').send({ chatId: 'chat-x' });

    // Cross-project access guard triggers null base → 404
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Project not found' });
  });

  it('returns 409 when chatId worktree is missing on diff-since-main', async () => {
    const chat = makeChat({
      id: 'chat-1',
      projectId: 'proj-1',
      worktreePath: '/tmp/gone',
      worktreeMissing: true,
    });

    const ctx: RouteContext = {
      db: {
        projects: {
          get: (id: string) => (id === 'proj-1' ? { path: '/tmp/proj-1' } : null),
        },
      },
      chats: {
        getChat: (_chatId: string) => chat,
        getEffectivePath: (_chatId: string) => null,
      },
    } as unknown as RouteContext;

    const app = express();
    app.use(express.json());
    app.use(gitRoutes(ctx));

    const res = await request(app).post('/api/projects/proj-1/git/diff-since-main').send({ chatId: 'chat-1' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: 'Worktree missing' });
  });

  it('returns 404 when project is not found (no chatId)', async () => {
    const ctx: RouteContext = {
      db: {
        projects: { get: () => null },
      },
      chats: {
        getChat: () => null,
        getEffectivePath: () => null,
      },
    } as unknown as RouteContext;

    const app = express();
    app.use(express.json());
    app.use(gitRoutes(ctx));

    const res = await request(app).post('/api/projects/missing/git/diff-since-main').send({});

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Project not found' });
  });
});
