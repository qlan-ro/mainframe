import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { chatRecoveryRoutes } from '../chat-recovery.js';

function makeCtx() {
  return {
    chats: {
      getChat: vi.fn(() => ({ id: 'c1' })),
      continueHere: vi.fn().mockResolvedValue(undefined),
      continueInProjectRoot: vi.fn().mockResolvedValue(undefined),
      recreateWorktree: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

function makeApp(ctx = makeCtx()) {
  const app = express();
  app.use(express.json());
  app.use(chatRecoveryRoutes(ctx));
  return app;
}

describe('chat recovery routes', () => {
  let ctx: ReturnType<typeof makeCtx>;

  beforeEach(() => {
    ctx = makeCtx();
  });

  describe('POST /api/chats/:id/recreate-worktree', () => {
    it('recreates and returns success', async () => {
      const res = await request(makeApp(ctx)).post('/api/chats/c1/recreate-worktree');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(ctx.chats.recreateWorktree).toHaveBeenCalledWith('c1');
    });

    it('maps a branch-gone failure to its statusCode and message', async () => {
      ctx.chats.recreateWorktree.mockRejectedValue(
        Object.assign(new Error('Branch "feat-x" no longer exists'), { statusCode: 409 }),
      );
      const res = await request(makeApp(ctx)).post('/api/chats/c1/recreate-worktree');
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: 'Branch "feat-x" no longer exists' });
    });

    it('404s for an unknown chat', async () => {
      ctx.chats.getChat.mockReturnValue(null);
      const res = await request(makeApp(ctx)).post('/api/chats/nope/recreate-worktree');
      expect(res.status).toBe(404);
      expect(ctx.chats.recreateWorktree).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/chats/:id/continue-here', () => {
    it('resets the session identity and returns success', async () => {
      const res = await request(makeApp(ctx)).post('/api/chats/c1/continue-here');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(ctx.chats.continueHere).toHaveBeenCalledWith('c1');
    });

    it('404s for an unknown chat', async () => {
      ctx.chats.getChat.mockReturnValue(null);
      const res = await request(makeApp(ctx)).post('/api/chats/nope/continue-here');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/chats/:id/continue-in-project-root', () => {
    it('detaches the worktree and returns success', async () => {
      const res = await request(makeApp(ctx)).post('/api/chats/c1/continue-in-project-root');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(ctx.chats.continueInProjectRoot).toHaveBeenCalledWith('c1');
    });

    it('maps failures to 400 with the error message', async () => {
      ctx.chats.continueInProjectRoot.mockRejectedValue(new Error('Chat has no worktree'));
      const res = await request(makeApp(ctx)).post('/api/chats/c1/continue-in-project-root');
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, error: 'Chat has no worktree' });
    });
  });
});
