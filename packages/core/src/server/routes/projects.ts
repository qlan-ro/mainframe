import { Router, Request, Response } from 'express';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { validate, CreateProjectBody } from './schemas.js';

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
      ctx.db.projects.updateLastOpened(existing.id);
      res.json({ success: true, data: existing });
      return;
    }

    const project = ctx.db.projects.create(path, name);
    res.json({ success: true, data: project });
  });

  router.delete('/api/projects/:id', (req: Request, res: Response) => {
    ctx.db.projects.removeWithChats(param(req, 'id'));
    res.json({ success: true });
  });

  return router;
}
