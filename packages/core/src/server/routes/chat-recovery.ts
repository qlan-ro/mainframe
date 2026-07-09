/**
 * Degraded-chat recovery routes — the actions behind the unified degraded-chat
 * card (missing transcript / missing worktree). All three re-emit an enriched
 * `chat.updated` via the ChatManager so clients clear the card live.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import { asyncHandler } from './async-handler.js';
import { okEmpty, fail } from './respond.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('routes:chat-recovery');

const Params = z.object({ id: z.string().min(1) });

export function chatRecoveryRoutes(ctx: RouteContext): Router {
  const router = Router();

  const post = (path: string, run: (chatId: string) => Promise<void>, label: string): void => {
    router.post(
      `/api/chats/:id/${path}`,
      asyncHandler(async (req, res) => {
        const parsed = Params.safeParse(req.params);
        if (!parsed.success) {
          fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid input');
          return;
        }
        const chatId = parsed.data.id;
        if (!ctx.chats.getChat(chatId)) {
          fail(res, 404, 'Chat not found');
          return;
        }
        try {
          await run(chatId);
          okEmpty(res);
        } catch (err) {
          const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 400;
          const message = err instanceof Error ? err.message : `Failed to ${label}`;
          log.warn({ err, chatId }, `${label} failed`);
          fail(res, statusCode, message);
        }
      }),
    );
  };

  post('recreate-worktree', (id) => ctx.chats.recreateWorktree(id), 'recreate worktree');
  post('continue-here', (id) => ctx.chats.continueHere(id), 'continue here');
  post('continue-in-project-root', (id) => ctx.chats.continueInProjectRoot(id), 'continue in project root');

  return router;
}
