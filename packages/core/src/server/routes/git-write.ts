import { Router, Request, Response } from 'express';
import type { RouteContext } from './types.js';
import { getProjectPath, param } from './types.js';
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

async function handleBranches(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const projectPath = getProjectPath(ctx, param(req, 'id'));
  if (!projectPath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  try {
    const svc = GitService.forProject(projectPath);
    const result = await svc.branches();
    res.json(result);
  } catch (err: any) {
    logger.warn({ err }, 'branches failed');
    res.status(500).json({ error: err.message });
  }
}

async function handleCheckout(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const projectPath = getProjectPath(ctx, param(req, 'id'));
  if (!projectPath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = GitCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: String(parsed.error) });
    return;
  }
  try {
    const svc = GitService.forProject(projectPath);
    await svc.checkout(parsed.data.branch);
    res.json({ ok: true });
  } catch (err: any) {
    logger.warn({ err }, 'checkout failed');
    res.status(500).json({ error: err.message });
  }
}

async function handleCreateBranch(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const projectPath = getProjectPath(ctx, param(req, 'id'));
  if (!projectPath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = GitCreateBranchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: String(parsed.error) });
    return;
  }
  try {
    const svc = GitService.forProject(projectPath);
    await svc.createBranch(parsed.data.name, parsed.data.startPoint);
    res.json({ ok: true });
  } catch (err: any) {
    logger.warn({ err }, 'createBranch failed');
    res.status(500).json({ error: err.message });
  }
}

async function handleFetch(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const projectPath = getProjectPath(ctx, param(req, 'id'));
  if (!projectPath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = GitFetchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: String(parsed.error) });
    return;
  }
  try {
    const svc = GitService.forProject(projectPath);
    const result = await svc.fetch(parsed.data.remote);
    res.json(result);
  } catch (err: any) {
    logger.warn({ err }, 'fetch failed');
    res.status(500).json({ error: err.message });
  }
}

async function handlePull(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const projectPath = getProjectPath(ctx, param(req, 'id'));
  if (!projectPath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = GitPullBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: String(parsed.error) });
    return;
  }
  try {
    const svc = GitService.forProject(projectPath);
    const result = await svc.pull(parsed.data.remote, parsed.data.branch);
    res.json(result);
  } catch (err: any) {
    logger.warn({ err }, 'pull failed');
    res.status(500).json({ error: err.message });
  }
}

async function handlePush(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const projectPath = getProjectPath(ctx, param(req, 'id'));
  if (!projectPath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = GitPushBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: String(parsed.error) });
    return;
  }
  try {
    const svc = GitService.forProject(projectPath);
    const result = await svc.push(parsed.data.branch, parsed.data.remote);
    res.json(result);
  } catch (err: any) {
    logger.warn({ err }, 'push failed');
    res.status(500).json({ error: err.message });
  }
}

async function handleMerge(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const projectPath = getProjectPath(ctx, param(req, 'id'));
  if (!projectPath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = GitMergeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: String(parsed.error) });
    return;
  }
  try {
    const svc = GitService.forProject(projectPath);
    const result = await svc.merge(parsed.data.branch);
    res.json(result);
  } catch (err: any) {
    logger.warn({ err }, 'merge failed');
    res.status(500).json({ error: err.message });
  }
}

async function handleRebase(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const projectPath = getProjectPath(ctx, param(req, 'id'));
  if (!projectPath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = GitRebaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: String(parsed.error) });
    return;
  }
  try {
    const svc = GitService.forProject(projectPath);
    const result = await svc.rebase(parsed.data.branch);
    res.json(result);
  } catch (err: any) {
    logger.warn({ err }, 'rebase failed');
    res.status(500).json({ error: err.message });
  }
}

async function handleAbort(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const projectPath = getProjectPath(ctx, param(req, 'id'));
  if (!projectPath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  try {
    const svc = GitService.forProject(projectPath);
    await svc.abort();
    res.json({ ok: true });
  } catch (err: any) {
    logger.warn({ err }, 'abort failed');
    res.status(500).json({ error: err.message });
  }
}

async function handleRenameBranch(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const projectPath = getProjectPath(ctx, param(req, 'id'));
  if (!projectPath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = GitRenameBranchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: String(parsed.error) });
    return;
  }
  try {
    const svc = GitService.forProject(projectPath);
    await svc.renameBranch(parsed.data.oldName, parsed.data.newName);
    res.json({ ok: true });
  } catch (err: any) {
    logger.warn({ err }, 'renameBranch failed');
    res.status(500).json({ error: err.message });
  }
}

async function handleDeleteBranch(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const projectPath = getProjectPath(ctx, param(req, 'id'));
  if (!projectPath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = GitDeleteBranchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: String(parsed.error) });
    return;
  }
  try {
    const svc = GitService.forProject(projectPath);
    const result = await svc.deleteBranch(parsed.data.name, parsed.data.force, parsed.data.remote);
    res.json(result);
  } catch (err: any) {
    logger.warn({ err }, 'deleteBranch failed');
    res.status(500).json({ error: err.message });
  }
}

async function handleUpdateAll(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const projectPath = getProjectPath(ctx, param(req, 'id'));
  if (!projectPath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  try {
    const svc = GitService.forProject(projectPath);
    const result = await svc.updateAll();
    res.json(result);
  } catch (err: any) {
    logger.warn({ err }, 'updateAll failed');
    res.status(500).json({ error: err.message });
  }
}

export function gitWriteRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/projects/:id/git/branches',
    asyncHandler((req, res) => handleBranches(ctx, req, res)),
  );
  router.post(
    '/api/projects/:id/git/checkout',
    asyncHandler((req, res) => handleCheckout(ctx, req, res)),
  );
  router.post(
    '/api/projects/:id/git/branch',
    asyncHandler((req, res) => handleCreateBranch(ctx, req, res)),
  );
  router.post(
    '/api/projects/:id/git/fetch',
    asyncHandler((req, res) => handleFetch(ctx, req, res)),
  );
  router.post(
    '/api/projects/:id/git/pull',
    asyncHandler((req, res) => handlePull(ctx, req, res)),
  );
  router.post(
    '/api/projects/:id/git/push',
    asyncHandler((req, res) => handlePush(ctx, req, res)),
  );
  router.post(
    '/api/projects/:id/git/merge',
    asyncHandler((req, res) => handleMerge(ctx, req, res)),
  );
  router.post(
    '/api/projects/:id/git/rebase',
    asyncHandler((req, res) => handleRebase(ctx, req, res)),
  );
  router.post(
    '/api/projects/:id/git/abort',
    asyncHandler((req, res) => handleAbort(ctx, req, res)),
  );
  router.post(
    '/api/projects/:id/git/rename-branch',
    asyncHandler((req, res) => handleRenameBranch(ctx, req, res)),
  );
  router.post(
    '/api/projects/:id/git/delete-branch',
    asyncHandler((req, res) => handleDeleteBranch(ctx, req, res)),
  );
  router.post(
    '/api/projects/:id/git/update-all',
    asyncHandler((req, res) => handleUpdateAll(ctx, req, res)),
  );

  return router;
}
