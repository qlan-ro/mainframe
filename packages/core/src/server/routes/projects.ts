import { Router, Request, Response } from 'express';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { validate, CreateProjectBody } from './schemas.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:projects');

export function projectRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get('/api/projects', (_req: Request, res: Response) => {
    const projects = ctx.db.projects.list();
    res.json({ success: true, data: projects });
  });

  router.get('/api/projects/:id', (req: Request, res: Response) => {
    const project = ctx.db.projects.get(param(req, 'id'));
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }
    res.json({ success: true, data: project });
  });

  router.post('/api/projects', (req: Request, res: Response) => {
    const parsed = validate(CreateProjectBody, req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error });
      return;
    }
    const { path, name } = parsed.data;

    const existing = ctx.db.projects.getByPath(path);
    if (existing) {
      res.status(409).json({ success: false, error: 'Project already registered', data: existing });
      return;
    }

    const project = ctx.db.projects.create(path, name);
    logger.info({ projectId: project.id, path }, 'project added');
    res.json({ success: true, data: project });
  });

  router.delete('/api/projects/:id', async (req: Request, res: Response) => {
    try {
      await ctx.chats.removeProject(param(req, 'id'));
      logger.info({ projectId: param(req, 'id') }, 'project deleted');
      res.json({ success: true });
    } catch (err: unknown) {
      logger.error({ err }, 'failed to remove project');
      res.status(500).json({ success: false, error: 'Failed to remove project' });
    }
  });

  return router;
}
