import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:external-sessions');

const importBodySchema = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9-]+$/),
  adapterId: z.string().min(1),
});

export function externalSessionRoutes(ctx: RouteContext): Router {
  const router = Router();

  // List importable external sessions (also ensures periodic scanning is active)
  router.get(
    '/api/projects/:projectId/external-sessions',
    asyncHandler(async (req: Request, res: Response) => {
      const projectId = param(req, 'projectId');
      const service = ctx.chats.getExternalSessionService();
      service.startAutoScan(projectId);
      const sessions = await service.scan(projectId);
      res.json({ success: true, data: sessions });
    }),
  );

  // Import an external session
  router.post(
    '/api/projects/:projectId/external-sessions/import',
    asyncHandler(async (req: Request, res: Response) => {
      const projectId = param(req, 'projectId');
      const result = importBodySchema.safeParse(req.body);
      if (!result.success) {
        logger.warn({ projectId, issues: result.error.issues }, 'invalid import request body');
        res.status(400).json({ success: false, error: 'Invalid request body' });
        return;
      }
      const { sessionId, adapterId } = result.data;

      const service = ctx.chats.getExternalSessionService();
      const chat = await service.importSession(projectId, sessionId, adapterId);
      res.json({ success: true, data: chat });
    }),
  );

  return router;
}
