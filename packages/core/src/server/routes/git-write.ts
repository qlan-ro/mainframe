import { Router, Request, Response } from 'express';
import type { ZodType } from 'zod';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import { asyncHandler } from './async-handler.js';
import { GitService } from '../../git/git-service.js';
import { createChildLogger } from '../../logger.js';
import {
  GitCheckoutBody,
  GitCreateBranchBody,
  GitFetchBody,
  GitPullBody,
  GitPushBody,
  GitMergeBody,
  GitRebaseBody,
  GitRenameBranchBody,
  GitDeleteBranchBody,
} from './schemas.js';

const logger = createChildLogger('routes:git-write');

function resolveProject(ctx: RouteContext, req: Request, res: Response): string | null {
  const chatId = (req.query.chatId as string | undefined) ?? (req.body?.chatId as string | undefined);
  const projectPath = getEffectivePath(ctx, param(req, 'id'), chatId);
  if (!projectPath) res.status(404).json({ error: 'Project not found' });
  return projectPath;
}

function gitRoute<T>(
  ctx: RouteContext,
  schema: ZodType<T>,
  handler: (svc: GitService, data: T) => Promise<unknown>,
  label: string,
) {
  return asyncHandler(async (req: Request, res: Response) => {
    const projectPath = resolveProject(ctx, req, res);
    if (!projectPath) return;
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: String(parsed.error) });
      return;
    }
    try {
      const result = await handler(GitService.forProject(projectPath), parsed.data);
      res.json(result ?? { ok: true });
    } catch (err: any) {
      logger.warn({ err }, `${label} failed`);
      res.status(500).json({ error: err.message });
    }
  });
}

function gitRouteNoBody(ctx: RouteContext, handler: (svc: GitService) => Promise<unknown>, label: string) {
  return asyncHandler(async (req: Request, res: Response) => {
    const projectPath = resolveProject(ctx, req, res);
    if (!projectPath) return;
    try {
      const result = await handler(GitService.forProject(projectPath));
      res.json(result ?? { ok: true });
    } catch (err: any) {
      logger.warn({ err }, `${label} failed`);
      res.status(500).json({ error: err.message });
    }
  });
}

export function gitWriteRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/projects/:id/git/branches',
    gitRouteNoBody(ctx, (svc) => svc.branches(), 'branches'),
  );
  router.post(
    '/api/projects/:id/git/checkout',
    gitRoute(ctx, GitCheckoutBody, (svc, d) => svc.checkout(d.branch), 'checkout'),
  );
  router.post(
    '/api/projects/:id/git/branch',
    gitRoute(ctx, GitCreateBranchBody, (svc, d) => svc.createBranch(d.name, d.startPoint), 'createBranch'),
  );
  router.post(
    '/api/projects/:id/git/fetch',
    gitRoute(ctx, GitFetchBody, (svc, d) => svc.fetch(d.remote), 'fetch'),
  );
  router.post(
    '/api/projects/:id/git/pull',
    gitRoute(ctx, GitPullBody, (svc, d) => svc.pull(d.remote, d.branch), 'pull'),
  );
  router.post(
    '/api/projects/:id/git/push',
    gitRoute(ctx, GitPushBody, (svc, d) => svc.push(d.branch, d.remote), 'push'),
  );
  router.post(
    '/api/projects/:id/git/merge',
    gitRoute(ctx, GitMergeBody, (svc, d) => svc.merge(d.branch), 'merge'),
  );
  router.post(
    '/api/projects/:id/git/rebase',
    gitRoute(ctx, GitRebaseBody, (svc, d) => svc.rebase(d.branch), 'rebase'),
  );
  router.post(
    '/api/projects/:id/git/abort',
    gitRouteNoBody(ctx, (svc) => svc.abort(), 'abort'),
  );
  router.post(
    '/api/projects/:id/git/rename-branch',
    gitRoute(ctx, GitRenameBranchBody, (svc, d) => svc.renameBranch(d.oldName, d.newName), 'renameBranch'),
  );
  router.post(
    '/api/projects/:id/git/delete-branch',
    gitRoute(ctx, GitDeleteBranchBody, (svc, d) => svc.deleteBranch(d.name, d.force, d.remote), 'deleteBranch'),
  );
  router.post(
    '/api/projects/:id/git/update-all',
    gitRouteNoBody(ctx, (svc) => svc.updateAll(), 'updateAll'),
  );

  return router;
}
