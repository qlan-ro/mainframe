import { Router, Request, Response } from 'express';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:chats');

export function chatRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get('/api/projects/:projectId/chats', (req: Request, res: Response) => {
    const chatsList = ctx.db.chats.list(param(req, 'projectId'));
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
        await ctx.chats.archiveChat(param(req, 'id'));
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

  router.get('/api/chats/:id/changes', (req: Request, res: Response) => {
    const files = ctx.db.chats.getModifiedFilesList(param(req, 'id'));
    res.json({ files });
  });

  return router;
}
