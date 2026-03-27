import { Router, Request, Response } from 'express';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';
import { extractSessionDiffs } from '../../messages/session-diffs.js';

const logger = createChildLogger('routes:chats');

export function chatRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get('/api/chats', (_req: Request, res: Response) => {
    const chats = ctx.chats.listAllChats();
    res.json({ success: true, data: chats });
  });

  router.get('/api/projects/:projectId/chats', (req: Request, res: Response) => {
    const chatsList = ctx.chats.listChats(param(req, 'projectId'));
    res.json({ success: true, data: chatsList });
  });

  router.get('/api/chats/:id', (req: Request, res: Response) => {
    const chat = ctx.chats.getChat(param(req, 'id'));
    if (!chat) {
      res.status(404).json({ success: false, error: 'Chat not found' });
      return;
    }
    res.json({ success: true, data: chat });
  });

  router.post(
    '/api/chats/:id/archive',
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const deleteWorktree = req.query.deleteWorktree !== 'false';
        await ctx.chats.archiveChat(param(req, 'id'), deleteWorktree);
        res.json({ success: true });
      } catch (err) {
        logger.warn({ err, chatId: param(req, 'id') }, 'Failed to archive chat');
        res.status(404).json({ success: false, error: 'Operation failed' });
      }
    }),
  );

  router.get(
    '/api/chats/:id/messages',
    asyncHandler(async (req: Request, res: Response) => {
      const messages = await ctx.chats.getDisplayMessages(param(req, 'id'));
      res.json({ success: true, data: messages });
    }),
  );

  router.get(
    '/api/chats/:id/pending-permission',
    asyncHandler(async (req: Request, res: Response) => {
      const permission = await ctx.chats.getPendingPermission(param(req, 'id'));
      res.json({ success: true, data: permission });
    }),
  );

  router.post('/api/chats/:id/unarchive', (req: Request, res: Response) => {
    const chatId = param(req, 'id');
    try {
      ctx.db.chats.update(chatId, { status: 'active' });
      const chat = ctx.db.chats.get(chatId);
      if (!chat) {
        res.status(404).json({ success: false, error: 'Chat not found' });
        return;
      }
      res.json({ success: true, data: chat });
    } catch (err) {
      logger.warn({ err, chatId }, 'Failed to unarchive chat');
      res.status(500).json({ success: false, error: 'Operation failed' });
    }
  });

  router.get(
    '/api/chats/:id/session-diffs',
    asyncHandler(async (req: Request, res: Response) => {
      const chatId = param(req, 'id');
      const messages = await ctx.chats.getMessages(chatId);
      const files = extractSessionDiffs(messages);
      res.json({ files });
    }),
  );

  return router;
}
