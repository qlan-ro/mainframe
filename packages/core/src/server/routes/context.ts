import { Router, Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { resolveAndValidatePath, resolveClaudeConfigPath } from './path-utils.js';
import { validate, AddMentionBody } from './schemas.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:context');

export function contextRoutes(ctx: RouteContext): Router {
  const router = Router();

  // Session context — GET /api/chats/:id/context
  router.get('/api/chats/:id/context', async (req: Request, res: Response) => {
    const chat = ctx.chats.getChat(param(req, 'id'));
    if (!chat) {
      res.status(404).json({ success: false, error: 'Chat not found' });
      return;
    }
    const project = ctx.db.projects.get(chat.projectId);
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }
    const effectivePath = chat.worktreePath ?? project.path;
    const context = await ctx.chats.getSessionContext(param(req, 'id'), effectivePath);
    res.json({ success: true, data: context });
  });

  // Session file content — GET /api/chats/:id/session-file?path=relative/path
  router.get(
    '/api/chats/:id/session-file',
    asyncHandler(async (req: Request, res: Response) => {
      const chat = ctx.chats.getChat(param(req, 'id'));
      if (!chat) {
        res.status(404).json({ success: false, error: 'Chat not found' });
        return;
      }
      const project = ctx.db.projects.get(chat.projectId);
      if (!project) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }

      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ success: false, error: 'path query required' });
        return;
      }

      try {
        const sessionBase = chat.worktreePath ?? project.path;
        const fullPath =
          resolveAndValidatePath(sessionBase, filePath) ?? resolveClaudeConfigPath(sessionBase, filePath);
        if (!fullPath) {
          res.status(403).json({ success: false, error: 'Path outside project' });
          return;
        }

        const content = await readFile(fullPath, 'utf-8');
        res.json({ path: filePath, content });
      } catch (err) {
        logger.warn({ err, path: filePath }, 'Failed to read session file');
        res.status(404).json({ success: false, error: 'File not found' });
      }
    }),
  );

  // Add mention — POST /api/chats/:id/mentions
  router.post('/api/chats/:id/mentions', (req: Request, res: Response) => {
    const parsed = validate(AddMentionBody, req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error });
      return;
    }
    const { kind, name, path: mentionPath } = parsed.data;
    const mention = {
      id: nanoid(),
      kind,
      source: 'user' as const,
      name,
      path: mentionPath,
      timestamp: new Date().toISOString(),
    };
    ctx.chats.addMention(param(req, 'id'), mention);
    res.json({ success: true, data: mention });
  });

  return router;
}
