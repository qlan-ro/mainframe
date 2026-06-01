import { Router } from 'express';
import type { Request, Response } from 'express';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { validate } from './schemas.js';
import { ok, okEmpty, fail } from './respond.js';
import { CreateChatBody, UpdateChatConfigBody, QueueEditBody } from '../ws-schemas.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:chat-commands');

export function chatCommandRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.post('/api/chats', async (req: Request, res: Response) => {
    const parsed = validate(CreateChatBody, req.body);
    if (!parsed.success) return void fail(res, 400, parsed.error);
    const d = parsed.data;
    try {
      const chat = await ctx.chats.createChatWithDefaults(
        d.projectId,
        d.adapterId,
        d.model,
        d.permissionMode,
        d.worktreePath,
        d.branchName,
      );
      ok(res, chat);
    } catch (err) {
      logger.error({ err }, 'createChat failed');
      fail(res, 500, err instanceof Error ? err.message : String(err));
    }
  });

  router.patch('/api/chats/:id/config', async (req: Request, res: Response) => {
    const parsed = validate(UpdateChatConfigBody, req.body);
    if (!parsed.success) return void fail(res, 400, parsed.error);
    const id = param(req, 'id');
    if (!ctx.chats.getChat(id)) return void fail(res, 404, 'Chat not found');
    const d = parsed.data;
    try {
      await ctx.chats.updateChatConfig(id, d.adapterId, d.model, d.permissionMode, d.planMode);
      ok(res, ctx.chats.getChat(id));
    } catch (err) {
      logger.error({ err, chatId: id }, 'updateChatConfig failed');
      fail(res, 500, err instanceof Error ? err.message : String(err));
    }
  });

  const command = (
    path: string,
    method: 'post' | 'patch' | 'delete',
    run: (id: string, req: Request) => Promise<void>,
    label: string,
  ): void => {
    router[method](path, async (req: Request, res: Response) => {
      const id = param(req, 'id');
      if (!ctx.chats.getChat(id)) return void fail(res, 404, 'Chat not found');
      try {
        await run(id, req);
        okEmpty(res);
      } catch (err) {
        logger.error({ err, chatId: id }, `${label} failed`);
        fail(res, 500, err instanceof Error ? err.message : String(err));
      }
    });
  };

  command('/api/chats/:id/interrupt', 'post', (id) => ctx.chats.interruptChat(id), 'interrupt');
  command('/api/chats/:id/resume', 'post', (id) => ctx.chats.resumeChat(id), 'resume');

  // queue-edit validates body inline so we can return 400 on bad input (not 500)
  router.patch('/api/chats/:id/queue/:messageId', async (req: Request, res: Response) => {
    const parsed = validate(QueueEditBody, req.body);
    if (!parsed.success) return void fail(res, 400, parsed.error);
    const id = param(req, 'id');
    if (!ctx.chats.getChat(id)) return void fail(res, 404, 'Chat not found');
    try {
      await ctx.chats.editQueuedMessage(id, param(req, 'messageId'), parsed.data.content);
      okEmpty(res);
    } catch (err) {
      logger.error({ err, chatId: id }, 'queue.edit failed');
      fail(res, 500, err instanceof Error ? err.message : String(err));
    }
  });

  command(
    '/api/chats/:id/queue/:messageId',
    'delete',
    (id, req) => ctx.chats.cancelQueuedMessage(id, param(req, 'messageId')),
    'queue.cancel',
  );

  return router;
}
