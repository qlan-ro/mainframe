import { Router, Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import { resolveAndValidatePath } from './path-utils.js';
import { asyncHandler } from './async-handler.js';
import { GitService } from '../../git/git-service.js';
import { createChildLogger } from '../../logger.js';
import { gitWriteRoutes } from './git-write.js';

const logger = createChildLogger('routes:git');

function isNotGitRepo(err: unknown): boolean {
  return (
    typeof (err as { message?: unknown }).message === 'string' &&
    (err as { message: string }).message.includes('not a git repository')
  );
}

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

async function detectMergeBase(svc: GitService): Promise<{ baseBranch: string; mergeBase: string } | null> {
  for (const base of ['main', 'master']) {
    const sha = await svc.mergeBase(base, 'HEAD');
    if (sha) return { baseBranch: base, mergeBase: sha };
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
    const baseInfo = await detectMergeBase(svc);

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
  } else {
    res.status(400).json({ error: 'Invalid source. Use "git".' });
  }
}

const StatusRequestSchema = z.object({
  chatId: z.string(),
});

function parsePortcelainStatus(output: string): { staged: string[]; unstaged: string[]; untracked: string[] } {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of output.split('\n').filter(Boolean)) {
    const indexStatus = line[0] ?? ' ';
    const workingStatus = line[1] ?? ' ';
    const filename = line.slice(3);

    if (indexStatus === '?' && workingStatus === '?') {
      untracked.push(filename);
      continue;
    }
    if (indexStatus !== ' ') staged.push(filename);
    if (workingStatus !== ' ') unstaged.push(filename);
  }

  return { staged, unstaged, untracked };
}

/** POST /api/git/status */
async function handleChatGitStatus(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const parsed = StatusRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'chatId is required' });
    return;
  }

  const { chatId } = parsed.data;
  const workDir = ctx.chats.getEffectivePath(chatId);
  if (!workDir) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }

  try {
    const svc = GitService.forProject(workDir);
    const output = await svc.statusRaw();
    const { staged, unstaged, untracked } = parsePortcelainStatus(output);
    res.json({ staged, unstaged, untracked });
  } catch (err) {
    if (!isNotGitRepo(err)) {
      logger.warn({ err, workDir, chatId }, 'Failed to get git status for chat');
    }
    res.status(400).json({ error: (err as Error).message ?? 'Unknown error' });
  }
}

/** POST /api/projects/:id/git/diff-since-main */
async function handleDiffSinceMain(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const chatId = req.body.chatId as string | undefined;
  const files = Array.isArray(req.body.files) ? (req.body.files as string[]) : undefined;

  const basePath = getEffectivePath(ctx, param(req, 'id'), chatId);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const svc = GitService.forProject(basePath);

    let baseBranch: string | null = null;
    let mergeBase: string | null = null;
    for (const base of ['main', 'master']) {
      const sha = await svc.mergeBase(base, 'HEAD');
      if (sha) {
        baseBranch = base;
        mergeBase = sha;
        break;
      }
    }

    if (!mergeBase) {
      res.json({ diffs: {}, baseBranch: null, mergeBase: null });
      return;
    }

    const nameStatusArgs = ['--name-status', `${mergeBase}..HEAD`, ...(files ? ['--', ...files] : [])];
    const nameStatusOutput = await svc.diff(nameStatusArgs);
    const changedFiles = parseDiffNameStatus(nameStatusOutput);

    const diffs: Record<string, { main: string; worktree: string }> = {};
    await Promise.all(
      changedFiles.map(async ({ status, path, oldPath }) => {
        let main = '';
        let worktree = '';

        if (!status.startsWith('A')) {
          try {
            main = await svc.show(`${mergeBase}:${oldPath ?? path}`);
          } catch {
            /* new file or binary */
          }
        }

        if (!status.startsWith('D')) {
          const resolvedPath = resolveAndValidatePath(basePath, path);
          if (resolvedPath) {
            try {
              worktree = await readFile(resolvedPath, 'utf-8');
            } catch {
              /* deleted file */
            }
          }
        }

        diffs[path] = { main, worktree };
      }),
    );

    res.json({ diffs, baseBranch, mergeBase });
  } catch (err) {
    logger.error({ err, basePath, chatId }, 'Failed to get diff since main');
    res.status(400).json({ error: (err as Error).message ?? 'Unknown error' });
  }
}

export function gitRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.post(
    '/api/git/status',
    asyncHandler((req, res) => handleChatGitStatus(ctx, req, res)),
  );
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
  router.post(
    '/api/projects/:id/git/diff-since-main',
    asyncHandler((req, res) => handleDiffSinceMain(ctx, req, res)),
  );

  router.use(gitWriteRoutes(ctx));

  return router;
}
