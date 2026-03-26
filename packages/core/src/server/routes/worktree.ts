import { Router } from 'express';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';

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

  return router;
}
