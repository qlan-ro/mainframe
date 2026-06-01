import { Router } from 'express';
import { z } from 'zod';
import { realpath } from 'node:fs/promises';
import type { RouteContext } from './types.js';
import { getProjectPath, param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';
import { getWorktrees, removeWorktree } from '../../workspace/index.js';
import { GitDeleteWorktreeBody } from './schemas.js';
import { killTasksForChat } from '../../background-tasks/kill.js';
import { ok, okEmpty, fail } from './respond.js';

const log = createChildLogger('routes:worktree');

const branchNameSchema = z
  .string()
  .min(1, 'Branch name is required')
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/, 'Invalid branch name')
  .refine((s) => !s.includes('..'), 'Branch name cannot contain ".."');

const EnableWorktreeBody = z.object({
  baseBranch: z.string().min(1, 'Base branch is required'),
  branchName: branchNameSchema,
});

const ForkWorktreeBody = z.object({
  baseBranch: z.string().min(1, 'Base branch is required'),
  branchName: branchNameSchema,
});

const AttachWorktreeBody = z.object({
  worktreePath: z.string().min(1, 'Worktree path is required'),
  branchName: z.string().min(1, 'Branch name is required'),
});

async function validateAndDeleteWorktree(
  ctx: RouteContext,
  projectId: string,
  projectPath: string,
  worktreePath: string,
  branchName: string | undefined,
): Promise<void> {
  const realProjectPath = await realpath(projectPath);
  let realWorktreePath: string;
  try {
    realWorktreePath = await realpath(worktreePath);
  } catch {
    throw new Error('Worktree path does not exist');
  }
  if (realWorktreePath === realProjectPath) {
    throw new Error('Cannot delete the main worktree');
  }
  const worktrees = await getWorktrees(projectPath);
  const match = worktrees.find((wt) => {
    try {
      return wt.path === realWorktreePath || wt.path === worktreePath;
    } catch {
      return false;
    }
  });
  if (!match) {
    throw new Error('Worktree path is not a registered worktree of this project');
  }
  const resolvedBranch = branchName ?? (match.branch ? match.branch.replace('refs/heads/', '') : undefined);
  if (!resolvedBranch) {
    throw new Error('Cannot determine branch name for worktree');
  }

  if (ctx.backgroundTasks) {
    // Match by realpath equality so a request path like '/wt/x/' or a symlinked alias
    // still finds the chat registered with the canonical path.
    const allChats = ctx.db.chats.list(projectId);
    const affected: typeof allChats = [];
    for (const c of allChats) {
      if (!c.worktreePath) continue;
      try {
        const real = await realpath(c.worktreePath);
        if (real === realWorktreePath || c.worktreePath === worktreePath) affected.push(c);
      } catch {
        // chat's worktreePath no longer exists on disk — fall back to raw string equality
        // so we still kill any tracker entries for the chat.
        if (c.worktreePath === worktreePath) affected.push(c);
      }
    }
    for (const c of affected) {
      try {
        const session = ctx.chats.getSessionForChat?.(c.id) ?? null;
        await killTasksForChat({
          chatId: c.id,
          worktreePath: realWorktreePath, // pass the canonical path so sweep targets the right spool prefix
          session,
          tracker: ctx.backgroundTasks,
        });
      } catch (err) {
        log.warn({ err, chatId: c.id }, 'killTasksForChat failed during delete-worktree');
      }
    }
  }

  await removeWorktree(projectPath, worktreePath, resolvedBranch);
  ctx.chats.notifyWorktreeDeleted(worktreePath);
}

export function worktreeRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.post(
    '/api/chats/:id/enable-worktree',
    asyncHandler(async (req, res) => {
      const chatId = param(req, 'id');
      const parsed = EnableWorktreeBody.safeParse(req.body);
      if (!parsed.success) {
        fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid input');
        return;
      }
      try {
        await ctx.chats.enableWorktree(chatId, parsed.data.baseBranch, parsed.data.branchName);
        okEmpty(res);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to enable worktree';
        log.warn({ err, chatId }, 'enable-worktree failed');
        fail(res, 400, message);
      }
    }),
  );

  router.post(
    '/api/chats/:id/disable-worktree',
    asyncHandler(async (req, res) => {
      const chatId = param(req, 'id');
      try {
        await ctx.chats.disableWorktree(chatId);
        okEmpty(res);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to disable worktree';
        log.warn({ err, chatId }, 'disable-worktree failed');
        fail(res, 400, message);
      }
    }),
  );

  router.post(
    '/api/chats/:id/fork-worktree',
    asyncHandler(async (req, res) => {
      const chatId = param(req, 'id');
      const parsed = ForkWorktreeBody.safeParse(req.body);
      if (!parsed.success) {
        fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid input');
        return;
      }
      try {
        const result = await ctx.chats.forkToWorktree(chatId, parsed.data.baseBranch, parsed.data.branchName);
        ok(res, { chatId: result.chatId });
      } catch (err) {
        const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
        const message = err instanceof Error ? err.message : 'Failed to fork to worktree';
        log.warn({ err, chatId }, 'fork-worktree failed');
        fail(res, statusCode, message);
      }
    }),
  );

  router.get(
    '/api/projects/:id/git/worktrees',
    asyncHandler(async (req, res) => {
      const projectPath = getProjectPath(ctx, param(req, 'id'));
      if (!projectPath) {
        fail(res, 404, 'Project not found');
        return;
      }
      const worktrees = await getWorktrees(projectPath);
      const filtered = worktrees.filter((wt) => wt.path !== projectPath);
      ok(res, { worktrees: filtered });
    }),
  );

  router.post(
    '/api/chats/:id/attach-worktree',
    asyncHandler(async (req, res) => {
      const chatId = param(req, 'id');
      const parsed = AttachWorktreeBody.safeParse(req.body);
      if (!parsed.success) {
        fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid input');
        return;
      }
      try {
        await ctx.chats.attachWorktree(chatId, parsed.data.worktreePath, parsed.data.branchName);
        okEmpty(res);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to attach worktree';
        log.warn({ err, chatId }, 'attach-worktree failed');
        fail(res, 400, message);
      }
    }),
  );

  router.post(
    '/api/projects/:id/git/delete-worktree',
    asyncHandler(async (req, res) => {
      const projectId = param(req, 'id');
      const projectPath = getProjectPath(ctx, projectId);
      if (!projectPath) {
        fail(res, 404, 'Project not found');
        return;
      }
      const parsed = GitDeleteWorktreeBody.safeParse(req.body);
      if (!parsed.success) {
        fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid input');
        return;
      }
      const { worktreePath, branchName } = parsed.data;
      try {
        await validateAndDeleteWorktree(ctx, projectId, projectPath, worktreePath, branchName);
        okEmpty(res);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete worktree';
        log.warn({ err, projectId, worktreePath }, 'delete-worktree failed');
        fail(res, 400, message);
      }
    }),
  );

  return router;
}
