import { Router, Request, Response } from 'express';
import type { RouteContext } from './types.js';

export function adapterRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get('/api/adapters', async (_req: Request, res: Response) => {
    const adaptersList = await ctx.adapters.list();
    res.json({ success: true, data: adaptersList });
  });

  return router;
}
