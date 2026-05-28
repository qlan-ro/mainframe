import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { worktreeRoutes } from '../worktree.js';
import { BackgroundTaskTracker } from '../../../background-tasks/tracker.js';
import * as killMod from '../../../background-tasks/kill.js';

vi.mock('../../../workspace/index.js', () => ({
  getWorktrees: vi.fn(async () => [{ path: '/wt/x', branch: 'refs/heads/feat/x' }]),
  removeWorktree: vi.fn(async () => {}),
}));
vi.mock('node:fs/promises', async () => ({
  ...(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')),
  realpath: vi.fn(async (p: string) => p),
}));

describe('POST /api/projects/:id/git/delete-worktree', () => {
  it('invokes killTasksForChat for every chat bound to the worktree before removeWorktree', async () => {
    const order: string[] = [];
    const killSpy = vi.spyOn(killMod, 'killTasksForChat').mockImplementation(async (args) => {
      order.push(`kill:${args.chatId}`);
      return { killed: [], failed: [], swept: [] };
    });
    const removeSpy = (await import('../../../workspace/index.js')).removeWorktree as ReturnType<typeof vi.fn>;
    removeSpy.mockImplementation(async () => {
      order.push('removeWorktree');
    });

    const tracker = new BackgroundTaskTracker();
    const chatBound = { id: 'chat-bound', projectId: 'p1', worktreePath: '/wt/x', branchName: 'feat/x' };
    const chatOther = { id: 'chat-other', projectId: 'p1', worktreePath: '/wt/other', branchName: 'feat/other' };

    const ctx: any = {
      db: {
        projects: { get: () => ({ id: 'p1', path: '/proj/p1' }) },
        chats: { list: () => [chatBound, chatOther] },
      },
      chats: { notifyWorktreeDeleted: vi.fn(), getSessionForChat: () => null },
      backgroundTasks: tracker,
    };

    const app = express().use(express.json()).use(worktreeRoutes(ctx));
    const res = await request(app)
      .post('/api/projects/p1/git/delete-worktree')
      .send({ worktreePath: '/wt/x', branchName: 'feat/x' });

    expect(res.status).toBe(200);
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'chat-bound', worktreePath: '/wt/x' }));
    expect(order.indexOf('kill:chat-bound')).toBeLessThan(order.indexOf('removeWorktree'));
  });

  it('falls back to string equality when realpath of a stored chat path throws', async () => {
    // Scenario: request and validation succeed for '/wt/x' (route's initial realpath calls work),
    // but when we later realpath the chat's stored worktreePath — also '/wt/x' — it throws (race
    // condition / TOCTOU: directory removed concurrently). We must still match by string equality
    // so the chat's tracker entries get killed.
    const killSpy = vi.spyOn(killMod, 'killTasksForChat').mockResolvedValue({ killed: [], failed: [], swept: [] });
    const fs = await import('node:fs/promises');
    const realpathMock = fs.realpath as ReturnType<typeof vi.fn>;
    // Route does: realpath(projectPath), realpath(worktreePath) — both pass.
    // Then chat-match loop calls realpath(chat.worktreePath) — that one throws.
    realpathMock
      .mockImplementationOnce(async (p: string) => p) // realpath(projectPath)
      .mockImplementationOnce(async (p: string) => p) // realpath(worktreePath) — the request path
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });

    const tracker = new BackgroundTaskTracker();
    const chat = { id: 'chat-bound', projectId: 'p1', worktreePath: '/wt/x', branchName: 'feat/x' };
    const ctx: any = {
      db: {
        projects: { get: () => ({ id: 'p1', path: '/proj/p1' }) },
        chats: { list: () => [chat] },
      },
      chats: { notifyWorktreeDeleted: vi.fn(), getSessionForChat: () => null },
      backgroundTasks: tracker,
    };

    const app = express().use(express.json()).use(worktreeRoutes(ctx));
    const res = await request(app)
      .post('/api/projects/p1/git/delete-worktree')
      .send({ worktreePath: '/wt/x', branchName: 'feat/x' });

    expect(res.status).toBe(200);
    expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'chat-bound' }));
  });
});
