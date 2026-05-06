import { Router, Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { z, type ZodType } from 'zod';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import { resolveAndValidatePath } from './path-utils.js';
import { asyncHandler } from './async-handler.js';
import { GitService } from '../../git/git-service.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:git-chat');

function isNotGitRepo(err: unknown): boolean {
  return (
    typeof (err as { message?: unknown }).message === 'string' &&
    (err as { message: string }).message.includes('not a git repository')
  );
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

const StatusBody = z.object({ chatId: z.string() });
const PushBody = z.object({ chatId: z.string() });
const StageBody = z.object({ chatId: z.string(), files: z.array(z.string()) });
const CommitBody = z.object({
  chatId: z.string(),
  message: z.string().min(1, 'Commit message cannot be empty'),
  files: z.array(z.string()),
});
const DiffSinceMainBody = z.object({
  chatId: z.string().optional(),
  files: z.array(z.string()).optional(),
});

/** Parses body, resolves the chat's working dir, validates file paths if asked. */
function chatRoute<T extends { chatId: string; files?: string[] }>(
  ctx: RouteContext,
  schema: ZodType<T>,
  label: string,
  handler: (svc: GitService, workDir: string, data: T, res: Response) => Promise<unknown>,
  opts?: { validatePaths?: boolean },
) {
  return asyncHandler(async (req: Request, res: Response) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      res.status(400).json({ error: firstIssue?.message ?? String(parsed.error) });
      return;
    }
    const data = parsed.data;
    const workDir = ctx.chats.getEffectivePath(data.chatId);
    if (!workDir) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }
    if (opts?.validatePaths && data.files) {
      for (const file of data.files) {
        if (!resolveAndValidatePath(workDir, file)) {
          res.status(400).json({ error: `Path outside project: ${file}` });
          return;
        }
      }
    }
    try {
      const result = await handler(GitService.forProject(workDir), workDir, data, res);
      if (!res.headersSent) res.json(result ?? { success: true });
    } catch (err) {
      if (!isNotGitRepo(err)) logger.error({ err, workDir, chatId: data.chatId }, `${label} failed`);
      res.status(400).json({ error: (err as Error).message ?? 'Unknown error' });
    }
  });
}

/**
 * POST /api/projects/:id/git/diff-since-main
 *
 * Returns per-file `{ main, worktree }` pairs covering everything that has
 * changed on the current branch versus its base (`main` or `master`). Uses
 * `git diff --name-status <mergeBase>` (no `..HEAD`) so the result includes
 * both committed branch changes AND uncommitted working-tree edits.
 * Untracked files are excluded — only tracked changes appear.
 */
async function handleDiffSinceMain(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const parsed = DiffSinceMainBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: String(parsed.error) });
    return;
  }
  const { chatId, files } = parsed.data;
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

    const nameStatusArgs = ['--name-status', mergeBase, ...(files ? ['--', ...files] : [])];
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

export function gitChatRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.post(
    '/api/git/status',
    chatRoute(ctx, StatusBody, 'status', async (svc) => {
      return parsePortcelainStatus(await svc.statusRaw());
    }),
  );

  router.post(
    '/api/git/stage',
    chatRoute(
      ctx,
      StageBody,
      'stage',
      async (svc, _wd, { files }) => {
        if (files.length > 0) await svc.stage(files);
        return { success: true };
      },
      { validatePaths: true },
    ),
  );

  router.post(
    '/api/git/unstage',
    chatRoute(
      ctx,
      StageBody,
      'unstage',
      async (svc, _wd, { files }) => {
        if (files.length > 0) await svc.unstage(files);
        return { success: true };
      },
      { validatePaths: true },
    ),
  );

  router.post(
    '/api/git/commit',
    chatRoute(
      ctx,
      CommitBody,
      'commit',
      async (svc, _wd, { files, message }) => {
        if (files.length > 0) await svc.stage(files);
        return { hash: await svc.commit(message) };
      },
      { validatePaths: true },
    ),
  );

  router.post(
    '/api/git/push',
    chatRoute(ctx, PushBody, 'push', async (svc, _wd, _data, res) => {
      const result = await svc.push();
      if (result.status === 'rejected') {
        res.status(400).json({ error: result.message ?? 'Push rejected' });
        return;
      }
      return { success: true };
    }),
  );

  router.post(
    '/api/projects/:id/git/diff-since-main',
    asyncHandler((req, res) => handleDiffSinceMain(ctx, req, res)),
  );

  return router;
}
