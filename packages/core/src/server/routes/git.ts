import { Router, Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import { resolveAndValidatePath } from './path-utils.js';
import { asyncHandler } from './async-handler.js';
import { execGit } from './exec-git.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:git');

function parseStatusLines(output: string): { status: string; path: string; oldPath?: string }[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line: string) => {
      const code = line.slice(0, 2).trim();
      const rest = line.slice(3);
      if (code.startsWith('R') || code.startsWith('C')) {
        const arrow = rest.indexOf(' -> ');
        if (arrow !== -1) return { status: code, path: rest.slice(arrow + 4), oldPath: rest.slice(0, arrow) };
      }
      return { status: code, path: rest };
    })
    .filter((f) => !f.path.endsWith('/'));
}

function parseDiffNameStatus(output: string): { status: string; path: string; oldPath?: string }[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const status = parts[0] ?? '';
      if (status.startsWith('R') || status.startsWith('C')) {
        return { status: status[0]!, path: parts[2] ?? '', oldPath: parts[1] };
      }
      return { status, path: parts[1] ?? '' };
    })
    .filter((f) => f.path.length > 0);
}

async function detectMergeBase(projectPath: string): Promise<{ baseBranch: string; mergeBase: string } | null> {
  for (const base of ['main', 'master']) {
    try {
      const sha = (await execGit(['merge-base', base, 'HEAD'], projectPath)).trim();
      return { baseBranch: base, mergeBase: sha };
    } catch {
      continue;
    }
  }
  return null;
}

/** GET /api/projects/:id/git/status?chatId=X */
async function handleGitStatus(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const status = await execGit(['status', '--porcelain'], basePath);
    const files = parseStatusLines(status);
    res.json({ files });
  } catch (err) {
    if ((err as { code?: unknown }).code !== 128) {
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
    const branch = (await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], basePath)).trim();
    res.json({ branch });
  } catch (err) {
    if ((err as { code?: unknown }).code !== 128) {
      logger.warn({ err, basePath }, 'Failed to get git branch');
    }
    res.json({ branch: null });
  }
}

/** GET /api/projects/:id/branch-diffs?chatId=X */
async function handleBranchDiffs(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const branch = (await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], basePath)).trim();
    const baseInfo = await detectMergeBase(basePath);

    if (!baseInfo || branch === baseInfo.baseBranch) {
      const statusOutput = await execGit(['status', '--porcelain'], basePath);
      const files = parseStatusLines(statusOutput);
      res.json({ branch, baseBranch: null, mergeBase: null, files });
      return;
    }

    const { baseBranch, mergeBase } = baseInfo;

    const committedOutput = await execGit(['diff', '--name-status', `${mergeBase}..HEAD`], basePath);
    const committedFiles = parseDiffNameStatus(committedOutput);

    const statusOutput = await execGit(['status', '--porcelain'], basePath);
    const uncommittedFiles = parseStatusLines(statusOutput);

    const fileMap = new Map<string, { status: string; path: string; oldPath?: string }>();
    for (const f of committedFiles) fileMap.set(f.path, f);
    for (const f of uncommittedFiles) fileMap.set(f.path, f);

    res.json({ branch, baseBranch, mergeBase, files: Array.from(fileMap.values()) });
  } catch (err) {
    if ((err as { code?: unknown }).code !== 128) {
      logger.warn({ err, basePath }, 'Failed to compute branch diffs');
    }
    res.json({ branch: null, baseBranch: null, mergeBase: null, files: [] });
  }
}

/** GET /api/projects/:id/diff?file=path&source=git&chatId=X&base=SHA */
async function handleDiff(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const chatId = req.query.chatId as string | undefined;
  const basePath = getEffectivePath(ctx, param(req, 'id'), chatId);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const file = req.query.file as string;
  const oldPath = (req.query.oldPath as string) || undefined;
  const source = (req.query.source as string) || 'git';
  const base = req.query.base as string | undefined;

  if (source === 'git') {
    try {
      const diffArgs = file
        ? base
          ? ['diff', `${base}..HEAD`, '--', file]
          : ['diff', '--', file]
        : base
          ? ['diff', `${base}..HEAD`]
          : ['diff'];
      const diff = await execGit(diffArgs, basePath);
      let original = '';
      if (file) {
        const headPath = oldPath || file;
        const ref = base ?? 'HEAD';
        try {
          original = await execGit(['show', `${ref}:${headPath}`], basePath);
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
      if ((err as { code?: unknown }).code !== 128) {
        logger.warn({ err, basePath, file }, 'Failed to compute git diff');
      }
      res.json({ diff: '', original: '', modified: '', source: 'git' });
    }
  } else {
    res.status(400).json({ error: 'Invalid source. Use "git".' });
  }
}

export function gitRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/projects/:id/branch-diffs',
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
    '/api/projects/:id/diff',
    asyncHandler((req, res) => handleDiff(ctx, req, res)),
  );

  return router;
}
