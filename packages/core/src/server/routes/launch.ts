import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { validate } from './schemas.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:launch');

const StartBody = z.object({
  configuration: z.object({
    name: z.string().min(1),
    runtimeExecutable: z.string().min(1),
    runtimeArgs: z.array(z.string()),
    port: z.number().nullable(),
    url: z.string().nullable(),
    preview: z.boolean().optional(),
  }),
});

export function launchRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/projects/:id/launch/status',
    asyncHandler(async (req: Request, res: Response) => {
      const project = ctx.db.projects.get(param(req, 'id'));
      if (!project) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      const manager = ctx.launchRegistry?.getOrCreate(project.id, project.path);
      const statuses = manager?.getAllStatuses() ?? {};
      res.json({ success: true, data: statuses });
    }),
  );

  router.post(
    '/api/projects/:id/launch/:name/start',
    asyncHandler(async (req: Request, res: Response) => {
      const project = ctx.db.projects.get(param(req, 'id'));
      if (!project) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      const parsed = validate(StartBody, req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
      }
      if (param(req, 'name') !== parsed.data.configuration.name) {
        res.status(400).json({ success: false, error: 'Route name does not match configuration name' });
        return;
      }
      const manager = ctx.launchRegistry?.getOrCreate(project.id, project.path);
      if (!manager) {
        res.status(500).json({ success: false, error: 'LaunchRegistry not available' });
        return;
      }
      try {
        await manager.start(parsed.data.configuration);
        logger.info({ projectId: project.id, name: parsed.data.configuration.name }, 'process started');
        res.json({ success: true });
      } catch (err) {
        logger.error({ err, projectId: project.id, name: parsed.data.configuration.name }, 'Failed to start process');
        res.status(500).json({ success: false, error: 'Failed to start process' });
      }
    }),
  );

  router.post(
    '/api/projects/:id/launch/:name/stop',
    asyncHandler(async (req: Request, res: Response) => {
      const project = ctx.db.projects.get(param(req, 'id'));
      if (!project) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      const name = param(req, 'name');
      const manager = ctx.launchRegistry?.getOrCreate(project.id, project.path);
      manager?.stop(name);
      logger.info({ projectId: project.id, name }, 'process stopped');
      res.json({ success: true });
    }),
  );

  return router;
}
