import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router, type Request, type Response } from 'express';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { parseLaunchConfig } from '../../launch/launch-config.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:launch');

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
      const name = param(req, 'name');

      // Read and validate launch config from disk — never trust the client body
      let raw: string;
      try {
        raw = await readFile(join(project.path, '.mainframe', 'launch.json'), 'utf-8');
      } catch {
        res.status(404).json({ success: false, error: 'No launch.json found for project' });
        return;
      }
      let parsed: ReturnType<typeof parseLaunchConfig>;
      try {
        parsed = parseLaunchConfig(JSON.parse(raw));
      } catch {
        res.status(400).json({ success: false, error: 'Invalid launch.json' });
        return;
      }
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
      }
      const config = parsed.data.configurations.find((c) => c.name === name);
      if (!config) {
        res.status(404).json({ success: false, error: `Configuration "${name}" not found in launch.json` });
        return;
      }
      const manager = ctx.launchRegistry?.getOrCreate(project.id, project.path);
      if (!manager) {
        res.status(500).json({ success: false, error: 'LaunchRegistry not available' });
        return;
      }
      try {
        await manager.start(config);
        logger.info({ projectId: project.id, name }, 'process started');
        res.json({ success: true });
      } catch (err) {
        logger.error({ err, projectId: project.id, name }, 'Failed to start process');
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
      await manager?.stop(name);
      logger.info({ projectId: project.id, name }, 'process stopped');
      res.json({ success: true });
    }),
  );

  return router;
}
