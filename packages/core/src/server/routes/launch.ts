import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router, type Request, type Response } from 'express';
import type { RouteContext } from './types.js';
import { param, getEffectivePath } from './types.js';
import { asyncHandler } from './async-handler.js';
import { parseLaunchConfig } from '../../launch/launch-config.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:launch');

function resolveLaunchPath(ctx: RouteContext, req: Request): { projectId: string; path: string } | null {
  const projectId = param(req, 'id');
  const chatId = req.query.chatId as string | undefined;
  const effectivePath = getEffectivePath(ctx, projectId, chatId);
  if (!effectivePath) return null;
  return { projectId, path: effectivePath };
}

export function launchRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/projects/:id/launch/status',
    asyncHandler(async (req: Request, res: Response) => {
      const resolved = resolveLaunchPath(ctx, req);
      if (!resolved) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      const manager = ctx.launchRegistry?.getOrCreate(resolved.projectId, resolved.path);
      const statuses = manager?.getAllStatuses() ?? {};

      // Include tunnel URLs for running processes
      const tunnelUrls: Record<string, string> = {};
      const tunnelManager = ctx.launchRegistry?.tunnelManager;
      if (tunnelManager) {
        for (const name of Object.keys(statuses)) {
          const url = tunnelManager.getUrl(`preview:${name}`);
          if (url) tunnelUrls[name] = url;
        }
      }

      res.json({ success: true, data: { statuses, tunnelUrls } });
    }),
  );

  router.get(
    '/api/projects/:id/launch/configs',
    asyncHandler(async (req: Request, res: Response) => {
      const resolved = resolveLaunchPath(ctx, req);
      if (!resolved) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      const configPath = join(resolved.path, '.mainframe', 'launch.json');
      try {
        const raw = await readFile(configPath, 'utf-8');
        const result = parseLaunchConfig(JSON.parse(raw));
        if (!result.success) {
          res.status(400).json({ success: false, error: result.error });
          return;
        }
        res.json({ success: true, data: result.data.configurations });
      } catch {
        res.json({ success: true, data: [] });
      }
    }),
  );

  router.post(
    '/api/projects/:id/launch/:name/start',
    asyncHandler(async (req: Request, res: Response) => {
      const resolved = resolveLaunchPath(ctx, req);
      if (!resolved) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      const name = param(req, 'name');

      // Read and validate launch config from disk — never trust the client body
      let raw: string;
      try {
        raw = await readFile(join(resolved.path, '.mainframe', 'launch.json'), 'utf-8');
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
      const manager = ctx.launchRegistry?.getOrCreate(resolved.projectId, resolved.path);
      if (!manager) {
        res.status(500).json({ success: false, error: 'LaunchRegistry not available' });
        return;
      }
      try {
        await manager.start(config);
        res.json({ success: true });
      } catch (err) {
        logger.error({ err, projectId: resolved.projectId, name }, 'failed to start launch process');
        res.status(500).json({ success: false, error: 'Failed to start process' });
      }
    }),
  );

  router.post(
    '/api/projects/:id/launch/:name/stop',
    asyncHandler(async (req: Request, res: Response) => {
      const resolved = resolveLaunchPath(ctx, req);
      if (!resolved) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      const name = param(req, 'name');
      const manager = ctx.launchRegistry?.getOrCreate(resolved.projectId, resolved.path);
      await manager?.stop(name);
      res.json({ success: true });
    }),
  );

  return router;
}
