import { Router, Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import { resolveAndValidatePath } from './path-utils.js';
import { asyncHandler } from './async-handler.js';
import { validate } from './schemas.js';
import { GitService } from '../../git/git-service.js';
import { createChildLogger } from '../../logger.js';
import { gitWriteRoutes } from './git-write.js';
import { gitChatRoutes } from './git-chat.js';
import { isNotGitRepo, parseDiffNameStatus, parseStatusLines } from '../../git/git-parse.js';
import { ok, fail } from './respond.js';

const GitDiffQuery = z.object({
  chatId: z.string().optional(),
  file: z.string().optional(),
  oldPath: z.string().optional(),
  // Validated (rejects a non-git source with 400) but not branched on — this
  // endpoint only serves git, and the response hardcodes source: 'git'.
  source: z.enum(['git']).optional(),
  base: z.string().optional(),
});

const logger = createChildLogger('routes:git');

/** GET /api/projects/:id/git/status?chatId=X */
async function handleGitStatus(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    fail(res, 404, 'Project not found');
    return;
  }

  try {
    const svc = GitService.forProject(basePath);
    const status = await svc.statusRaw();
    const files = parseStatusLines(status);
    ok(res, { files });
  } catch (err) {
    if (!isNotGitRepo(err)) {
      logger.warn({ err, basePath }, 'Failed to get git status');
    }
    ok(res, { files: [], error: 'Not a git repository' });
  }
}

/** GET /api/projects/:id/git/working-stat?chatId=X */
async function handleWorkingStat(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    fail(res, 404, 'Project not found');
    return;
  }

  try {
    const svc = GitService.forProject(basePath);
    ok(res, await svc.workingStat());
  } catch (err) {
    logger.warn({ err, basePath }, 'Failed to compute working stat');
    fail(res, 500, (err as Error).message ?? 'Unknown error');
  }
}

/** GET /api/projects/:id/git/branch?chatId=X */
async function handleGitBranch(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    fail(res, 404, 'Project not found');
    return;
  }

  try {
    const svc = GitService.forProject(basePath);
    const branch = await svc.currentBranch();
    ok(res, { branch });
  } catch (err) {
    if (!isNotGitRepo(err)) {
      logger.warn({ err, basePath }, 'Failed to get git branch');
    }
    ok(res, { branch: null });
  }
}

/** GET /api/projects/:id/git/branch-diffs?chatId=X */
async function handleBranchDiffs(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    fail(res, 404, 'Project not found');
    return;
  }

  try {
    const svc = GitService.forProject(basePath);
    const branch = await svc.currentBranch();
    const baseInfo = await svc.detectBaseBranch();

    if (!baseInfo || branch === baseInfo.baseBranch) {
      ok(res, { branch, baseBranch: null, mergeBase: null, files: [] });
      return;
    }

    const { baseBranch, mergeBase } = baseInfo;
    const committedOutput = await svc.diff(['--name-status', `${mergeBase}..HEAD`]);
    const files = parseDiffNameStatus(committedOutput);

    ok(res, { branch, baseBranch, mergeBase, files });
  } catch (err) {
    if (!isNotGitRepo(err)) {
      logger.warn({ err, basePath }, 'Failed to compute branch diffs');
    }
    ok(res, { branch: null, baseBranch: null, mergeBase: null, files: [] });
  }
}

/** GET /api/projects/:id/git/diff?file=path&source=git&chatId=X&base=SHA */
async function handleDiff(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const parsed = validate(GitDiffQuery, req.query);
  if (!parsed.success) {
    fail(res, 400, parsed.error);
    return;
  }

  const { chatId, file, oldPath, base } = parsed.data;
  const basePath = getEffectivePath(ctx, param(req, 'id'), chatId);
  if (!basePath) {
    fail(res, 404, 'Project not found');
    return;
  }

  try {
    const svc = GitService.forProject(basePath);
    const diffArgs = file ? (base ? [`${base}..HEAD`, '--', file] : ['--', file]) : base ? [`${base}..HEAD`] : [];
    const diff = await svc.diff(diffArgs);
    let original = '';
    if (file) {
      const headPath = oldPath || file;
      const ref = base ?? 'HEAD';
      try {
        original = await svc.show(`${ref}:${headPath}`);
      } catch {
        /* new file */
      }
    }
    let modified = '';
    if (file) {
      const resolvedFile = resolveAndValidatePath(basePath, file);
      if (!resolvedFile) {
        fail(res, 403, 'Path outside project');
        return;
      }
      try {
        modified = await readFile(resolvedFile, 'utf-8');
      } catch {
        /* deleted file */
      }
    }
    ok(res, { diff, original, modified, source: 'git' });
  } catch (err) {
    if (!isNotGitRepo(err)) {
      logger.warn({ err, basePath, file }, 'Failed to compute git diff');
    }
    ok(res, { diff: '', original: '', modified: '', source: 'git' });
  }
}

export function gitRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/projects/:id/git/branch-diffs',
    asyncHandler((req, res) => handleBranchDiffs(ctx, req, res)),
  );
  router.get(
    '/api/projects/:id/git/status',
    asyncHandler((req, res) => handleGitStatus(ctx, req, res)),
  );
  router.get(
    '/api/projects/:id/git/working-stat',
    asyncHandler((req, res) => handleWorkingStat(ctx, req, res)),
  );
  router.get(
    '/api/projects/:id/git/branch',
    asyncHandler((req, res) => handleGitBranch(ctx, req, res)),
  );
  router.get(
    '/api/projects/:id/git/diff',
    asyncHandler((req, res) => handleDiff(ctx, req, res)),
  );

  router.use(gitChatRoutes(ctx));
  router.use(gitWriteRoutes(ctx));

  return router;
}
