import { Router, Request, Response } from 'express';
import type { RouteContext } from './types.js';
import { ok, okEmpty, fail } from './respond.js';
import { asyncHandler } from './async-handler.js';
import { validate, QuotaProviderParams } from './schemas.js';

/**
 * Provider quota read + manual refresh. The merged blob is account-wide (no chat scope);
 * `okEmpty` means "no quota known for this provider yet", not an error.
 */
export function quotaRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get('/api/providers/:id/quota', (req: Request, res: Response) => {
    const parsed = validate(QuotaProviderParams, { id: req.params.id });
    if (!parsed.success) return fail(res, 400, parsed.error);
    const quota = ctx.quota?.get(parsed.data.id);
    if (!quota) return okEmpty(res);
    ok(res, quota);
  });

  router.post(
    '/api/providers/:id/quota/refresh',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = validate(QuotaProviderParams, { id: req.params.id });
      if (!parsed.success) return fail(res, 400, parsed.error);
      if (!ctx.quota) return fail(res, 503, 'Quota service unavailable');
      const quota = await ctx.quota.refresh(parsed.data.id);
      if (!quota) return okEmpty(res);
      ok(res, quota);
    }),
  );

  return router;
}
