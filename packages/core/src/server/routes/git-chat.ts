import { Router, Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { z, type ZodType } from 'zod';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import { resolveAndValidatePath } from './path-utils.js';
import { asyncHandler } from './async-handler.js';
import { GitService } from '../../git/git-service.js';
import { createChildLogger } from '../../logger.js';
import { isNotGitRepo, parseDiffNameStatus, parseStatusBuckets } from '../../git/git-parse.js';
import { ok, okEmpty, fail } from './respond.js';

const logger = createChildLogger('routes:git-chat');

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
      fail(res, 400, firstIssue?.message ?? String(parsed.error));
      return;
    }
    const data = parsed.data;
    const workDir = ctx.chats.getEffectivePath(data.chatId);
    if (!workDir) {
      const chat = ctx.chats.getChat(data.chatId);
      if (chat?.worktreeMissing) {
        fail(res, 409, 'Worktree missing');
      } else {
        fail(res, 404, 'Chat not found');
      }
      return;
    }
    if (opts?.validatePaths && data.files) {
      for (const file of data.files) {
        if (!resolveAndValidatePath(workDir, file)) {
          fail(res, 400, `Path outside project: ${file}`);
          return;
        }
      }
    }
    try {
      const result = await handler(GitService.forProject(workDir), workDir, data, res);
      if (!res.headersSent) {
        if (result === undefined) okEmpty(res);
        else ok(res, result);
      }
    } catch (err) {
      if (!isNotGitRepo(err)) logger.error({ err, workDir, chatId: data.chatId }, `${label} failed`);
      fail(res, 400, (err as Error).message ?? 'Unknown error');
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
    fail(res, 400, String(parsed.error));
    return;
  }
  const { chatId, files } = parsed.data;
  const projectId = param(req, 'id');
  const basePath = getEffectivePath(ctx, projectId, chatId);
  if (!basePath) {
    if (chatId && ctx.chats.getChat(chatId)?.worktreeMissing) {
      fail(res, 409, 'Worktree missing');
    } else {
      fail(res, 404, 'Project not found');
    }
    return;
  }

  try {
    const svc = GitService.forProject(basePath);
    const baseInfo = await svc.detectBaseBranch();
    if (!baseInfo) {
      ok(res, { diffs: {}, baseBranch: null, mergeBase: null });
      return;
    }
    const { baseBranch, mergeBase } = baseInfo;

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

    ok(res, { diffs, baseBranch, mergeBase });
  } catch (err) {
    logger.error({ err, basePath, chatId }, 'Failed to get diff since main');
    fail(res, 400, (err as Error).message ?? 'Unknown error');
  }
}

export function gitChatRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.post(
    '/api/git/status',
    chatRoute(ctx, StatusBody, 'status', async (svc) => {
      return parseStatusBuckets(await svc.statusRaw());
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
        return;
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
        return;
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
        fail(res, 400, result.message ?? 'Push rejected');
        return;
      }
      return;
    }),
  );

  router.post(
    '/api/projects/:id/git/diff-since-main',
    asyncHandler((req, res) => handleDiffSinceMain(ctx, req, res)),
  );

  return router;
}
