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
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const svc = GitService.forProject(basePath);
    const status = await svc.statusRaw();
    const files = parseStatusLines(status);
    res.json({ files });
  } catch (err) {
    if (!isNotGitRepo(err)) {
      logger.warn({ err, basePath }, 'Failed to get git status');
    }
    res.json({ files: [], error: 'Not a git repository' });
  }
}

/** GET /api/projects/:id/git/branch?chatId=X */
async function handleGitBranch(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const svc = GitService.forProject(basePath);
    const branch = await svc.currentBranch();
    res.json({ branch });
  } catch (err) {
    if (!isNotGitRepo(err)) {
      logger.warn({ err, basePath }, 'Failed to get git branch');
    }
    res.json({ branch: null });
  }
}

/** GET /api/projects/:id/git/branch-diffs?chatId=X */
async function handleBranchDiffs(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const svc = GitService.forProject(basePath);
    const branch = await svc.currentBranch();
    const baseInfo = await svc.detectBaseBranch();

    if (!baseInfo || branch === baseInfo.baseBranch) {
      res.json({ branch, baseBranch: null, mergeBase: null, files: [] });
      return;
    }

    const { baseBranch, mergeBase } = baseInfo;
    const committedOutput = await svc.diff(['--name-status', `${mergeBase}..HEAD`]);
    const files = parseDiffNameStatus(committedOutput);

    res.json({ branch, baseBranch, mergeBase, files });
  } catch (err) {
    if (!isNotGitRepo(err)) {
      logger.warn({ err, basePath }, 'Failed to compute branch diffs');
    }
    res.json({ branch: null, baseBranch: null, mergeBase: null, files: [] });
  }
}

/** GET /api/projects/:id/git/diff?file=path&source=git&chatId=X&base=SHA */
async function handleDiff(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const parsed = validate(GitDiffQuery, req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const { chatId, file, oldPath, base } = parsed.data;
  const basePath = getEffectivePath(ctx, param(req, 'id'), chatId);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
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
        res.status(403).json({ error: 'Path outside project' });
        return;
      }
      try {
        modified = await readFile(resolvedFile, 'utf-8');
      } catch {
        /* deleted file */
      }
    }
    res.json({ diff, original, modified, source: 'git' });
  } catch (err) {
    if (!isNotGitRepo(err)) {
      logger.warn({ err, basePath, file }, 'Failed to compute git diff');
    }
    res.json({ diff: '', original: '', modified: '', source: 'git' });
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
