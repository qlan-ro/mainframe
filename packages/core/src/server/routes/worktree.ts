import { Router } from 'express';
import { z } from 'zod';
import { realpath } from 'node:fs/promises';
import type { RouteContext } from './types.js';
import { getProjectPath, param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';
import { getWorktrees, removeWorktree } from '../../workspace/index.js';
import { GitDeleteWorktreeBody } from './schemas.js';

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
  removeWorktree(projectPath, worktreePath, resolvedBranch);
}

export function worktreeRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.post(
    '/api/chats/:id/enable-worktree',
    asyncHandler(async (req, res) => {
      const chatId = param(req, 'id');
      const parsed = EnableWorktreeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
        return;
      }
      try {
        await ctx.chats.enableWorktree(chatId, parsed.data.baseBranch, parsed.data.branchName);
        res.json({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to enable worktree';
        log.warn({ err, chatId }, 'enable-worktree failed');
        res.status(400).json({ error: message });
      }
    }),
  );

  router.post(
    '/api/chats/:id/disable-worktree',
    asyncHandler(async (req, res) => {
      const chatId = param(req, 'id');
      try {
        await ctx.chats.disableWorktree(chatId);
        res.json({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to disable worktree';
        log.warn({ err, chatId }, 'disable-worktree failed');
        res.status(400).json({ error: message });
      }
    }),
  );

  router.post(
    '/api/chats/:id/fork-worktree',
    asyncHandler(async (req, res) => {
      const chatId = param(req, 'id');
      const parsed = ForkWorktreeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
        return;
      }
      try {
        const result = await ctx.chats.forkToWorktree(chatId, parsed.data.baseBranch, parsed.data.branchName);
        res.json({ success: true, chatId: result.chatId });
      } catch (err) {
        const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
        const message = err instanceof Error ? err.message : 'Failed to fork to worktree';
        log.warn({ err, chatId }, 'fork-worktree failed');
        res.status(statusCode).json({ error: message });
      }
    }),
  );

  router.get(
    '/api/projects/:id/git/worktrees',
    asyncHandler(async (req, res) => {
      const projectPath = getProjectPath(ctx, param(req, 'id'));
      if (!projectPath) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const worktrees = await getWorktrees(projectPath);
      const filtered = worktrees.filter((wt) => wt.path !== projectPath);
      res.json({ worktrees: filtered });
    }),
  );

  router.post(
    '/api/chats/:id/attach-worktree',
    asyncHandler(async (req, res) => {
      const chatId = param(req, 'id');
      const parsed = AttachWorktreeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
        return;
      }
      try {
        await ctx.chats.attachWorktree(chatId, parsed.data.worktreePath, parsed.data.branchName);
        res.json({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to attach worktree';
        log.warn({ err, chatId }, 'attach-worktree failed');
        res.status(400).json({ error: message });
      }
    }),
  );

  router.post(
    '/api/projects/:id/git/delete-worktree',
    asyncHandler(async (req, res) => {
      const projectId = param(req, 'id');
      const projectPath = getProjectPath(ctx, projectId);
      if (!projectPath) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const parsed = GitDeleteWorktreeBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
        return;
      }
      const { worktreePath, branchName } = parsed.data;
      try {
        await validateAndDeleteWorktree(projectPath, worktreePath, branchName);
        res.json({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete worktree';
        log.warn({ err, projectId, worktreePath }, 'delete-worktree failed');
        res.status(400).json({ error: message });
      }
    }),
  );

  return router;
}
