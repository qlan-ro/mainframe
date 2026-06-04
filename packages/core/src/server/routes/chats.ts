import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { Chat, SessionTuning } from '@qlan-ro/mainframe-types';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { ok } from './respond.js';
import { createChildLogger } from '../../logger.js';
import { extractSessionFilePaths } from '../../messages/session-files.js';
import { readToolResultFromJsonl } from '../../messages/read-tool-result-from-jsonl.js';
import { computeSessionFilePath } from '../../chat/event-handler.js';

const logger = createChildLogger('routes:chats');

export function chatRoutes(ctx: RouteContext): Router {
  const router = Router();

  const TAG_NAME_PATTERN = /^[a-z0-9-]+$/;

  const ListQuery = z.object({
    project: z.string().optional(),
    tags: z
      .string()
      .optional()
      .refine(
        (v) =>
          v === undefined ||
          v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .every((t) => TAG_NAME_PATTERN.test(t)),
        { message: 'Tag values must match [a-z0-9-]+' },
      ),
    synthetic: z.string().optional(),
  });

  router.get('/api/chats', (req: Request, res: Response) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const tagsAll = parsed.data.tags
      ? parsed.data.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const synth = parsed.data.synthetic
      ? new Set(
          parsed.data.synthetic
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
      : new Set<string>();
    const chats = ctx.chats.listFiltered({
      projectId: parsed.data.project,
      tagsAll,
      hasWorktree: synth.has('has-worktree'),
      includeArchived: true,
    });
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

  router.patch('/api/chats/:id/title', (req: Request, res: Response) => {
    const chatId = param(req, 'id');
    const parsed = titleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Title is required' });
      return;
    }
    try {
      ctx.chats.renameChat(chatId, parsed.data.title);
      const chat = ctx.chats.getChat(chatId);
      if (!chat) {
        res.status(404).json({ success: false, error: 'Chat not found' });
        return;
      }
      res.json({ success: true, data: chat });
    } catch (err) {
      logger.warn({ err, chatId }, 'Failed to rename chat');
      res.status(500).json({ success: false, error: 'Operation failed' });
    }
  });

  const titleSchema = z.object({ title: z.string().trim().min(1) });
  const pinSchema = z.object({ pinned: z.boolean() });

  const EFFORT_VALUES = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
  const tuningSchema = z.object({
    effort: z.enum(EFFORT_VALUES).nullable().optional(),
    fast: z.boolean().nullable().optional(),
    ultracode: z.boolean().nullable().optional(),
    adaptiveThinking: z.boolean().nullable().optional(),
  });
  const effortOnlySchema = z.object({ effort: z.enum(EFFORT_VALUES).nullable() });

  // One code path for both routes. Persists the RAW partial (tri-state: only touched
  // fields become concrete; undefined skipped, null written) — NO clamp/coercion here.
  function applyChatTuning(chatId: string, partial: SessionTuning): Chat | null {
    ctx.db.chats.update(chatId, partial);
    const chat = ctx.db.chats.get(chatId);
    if (!chat) return null;
    ctx.chats?.syncChatFields?.(chatId, partial);
    void ctx.chats?.applyTuning?.(chatId); // live apply re-reads + resolves (Phase H); no-op if no method yet
    return chat;
  }

  router.patch('/api/chats/:id/pinned', (req: Request, res: Response) => {
    const chatId = param(req, 'id');
    const parsed = pinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'pinned (boolean) is required' });
      return;
    }
    try {
      ctx.db.chats.update(chatId, { pinned: parsed.data.pinned });
      const chat = ctx.db.chats.get(chatId);
      if (!chat) {
        res.status(404).json({ success: false, error: 'Chat not found' });
        return;
      }
      ctx.chats?.syncChatFields?.(chatId, { pinned: parsed.data.pinned });
      res.json({ success: true, data: chat });
    } catch (err) {
      logger.warn({ err, chatId }, 'Failed to update pinned state');
      res.status(500).json({ success: false, error: 'Operation failed' });
    }
  });

  router.patch('/api/chats/:id/tuning', (req: Request, res: Response) => {
    const chatId = param(req, 'id');
    const parsed = tuningSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'invalid tuning payload' });
      return;
    }
    try {
      const chat = applyChatTuning(chatId, parsed.data);
      if (!chat) {
        res.status(404).json({ success: false, error: 'Chat not found' });
        return;
      }
      res.json({ success: true, data: chat });
    } catch (err) {
      logger.warn({ err, chatId }, 'Failed to update tuning');
      res.status(500).json({ success: false, error: 'Operation failed' });
    }
  });

  router.patch('/api/chats/:id/effort', (req: Request, res: Response) => {
    const chatId = param(req, 'id');
    const parsed = effortOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'effort must be a valid level or null' });
      return;
    }
    try {
      const chat = applyChatTuning(chatId, { effort: parsed.data.effort });
      if (!chat) {
        res.status(404).json({ success: false, error: 'Chat not found' });
        return;
      }
      res.json({ success: true, data: chat });
    } catch (err) {
      logger.warn({ err, chatId }, 'Failed to update effort');
      res.status(500).json({ success: false, error: 'Operation failed' });
    }
  });

  router.post('/api/chats/:id/unarchive', (req: Request, res: Response) => {
    const chatId = param(req, 'id');
    try {
      const chat = ctx.chats.unarchiveChat(chatId);
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
    '/api/chats/:id/session-files',
    asyncHandler(async (req: Request, res: Response) => {
      const chatId = param(req, 'id');
      // Load from disk to include subagent file changes not present in the
      // in-memory cache during an active session.
      const messages = await ctx.chats.getMessagesFromDisk(chatId);
      const files = extractSessionFilePaths(messages);
      ok(res, { files });
    }),
  );

  const ToolResultParams = z.object({
    id: z.string().min(1),
    toolUseId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  });

  router.get(
    '/api/chats/:id/tool-result/:toolUseId',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = ToolResultParams.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.message });
        return;
      }
      const chat = ctx.chats.getChat(parsed.data.id);
      if (!chat) {
        res.status(404).json({ success: false, error: 'Chat not found' });
        return;
      }
      let filePath = chat.sessionFilePath;
      if (!filePath && chat.claudeSessionId) {
        const projectPath = ctx.db.projects.get(chat.projectId)?.path ?? null;
        const cwd = chat.worktreePath ?? projectPath;
        if (cwd) {
          filePath = computeSessionFilePath(cwd, chat.claudeSessionId);
          ctx.db.chats.update(chat.id, { sessionFilePath: filePath });
        }
      }
      if (!filePath) {
        res.status(404).json({ success: false, error: 'No session file for chat' });
        return;
      }
      const content = await readToolResultFromJsonl(filePath, parsed.data.toolUseId);
      if (content === null) {
        res.status(404).json({ success: false, error: 'Tool result not available' });
        return;
      }
      res.json({ success: true, data: { content } });
    }),
  );

  return router;
}
