import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { TAG_PALETTE } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:tags');

const ColorSchema = z.enum(TAG_PALETTE);
const CreateBody = z.object({ name: z.string(), color: ColorSchema.optional() });
const PatchBody = z
  .object({ rename: z.string().optional(), color: ColorSchema.optional() })
  .refine((v) => v.rename !== undefined || v.color !== undefined, {
    message: 'rename or color required',
  });
const SetChatTagsBody = z.object({ tags: z.array(z.string()) });

export function tagRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get('/api/tags', (_req: Request, res: Response) => {
    res.json({ success: true, data: ctx.db.tags.list() });
  });

  router.post('/api/tags', (req: Request, res: Response) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    try {
      const tag = ctx.db.tags.upsert(parsed.data.name, parsed.data.color);
      res.status(201).json({ success: true, data: tag });
    } catch (err) {
      logger.warn({ err }, 'create tag failed');
      res.status(400).json({ success: false, error: String((err as Error).message) });
    }
  });

  router.patch('/api/tags/:name', (req: Request, res: Response) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const name = param(req, 'name');
    if (!ctx.db.tags.get(name)) {
      res.status(404).json({ success: false, error: 'Tag not found' });
      return;
    }
    try {
      if (parsed.data.rename !== undefined) ctx.db.tags.rename(name, parsed.data.rename);
      const final = parsed.data.rename ?? name;
      if (parsed.data.color !== undefined) ctx.db.tags.setColor(final, parsed.data.color);
      const result = ctx.db.tags.get(final);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.warn({ err, name }, 'update tag failed');
      res.status(400).json({ success: false, error: String((err as Error).message) });
    }
  });

  router.delete('/api/tags/:name', (req: Request, res: Response) => {
    const name = param(req, 'name');
    if (!ctx.db.tags.get(name)) {
      res.status(404).json({ success: false, error: 'Tag not found' });
      return;
    }
    ctx.db.tags.remove(name);
    res.status(204).end();
  });

  router.get('/api/chats/:id/tags', (req: Request, res: Response) => {
    const tags = ctx.db.chatTags.listForChat(param(req, 'id'));
    res.json({ success: true, data: tags });
  });

  router.put('/api/chats/:id/tags', (req: Request, res: Response) => {
    const parsed = SetChatTagsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const chatId = param(req, 'id');
    try {
      ctx.db.chatTags.setForChat(chatId, parsed.data.tags, ctx.db.tags);
      const persisted = ctx.db.chatTags.listForChat(chatId);
      ctx.chats.syncChatTags(chatId, persisted);
      res.json({ success: true, data: persisted });
    } catch (err) {
      logger.warn({ err, chatId }, 'set chat tags failed');
      res.status(400).json({ success: false, error: String((err as Error).message) });
    }
  });

  return router;
}
