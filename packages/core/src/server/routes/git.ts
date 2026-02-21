import { Router, Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import { resolveAndValidatePath } from './path-utils.js';
import { asyncHandler } from './async-handler.js';
import { execGit } from './exec-git.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:git');

/** GET /api/projects/:id/git/status?chatId=X */
async function handleGitStatus(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const status = await execGit(['status', '--porcelain'], basePath);
    const files = status
      .split('\n')
      .filter(Boolean)
      .map((line: string) => {
        const code = line.slice(0, 2).trim();
        const rest = line.slice(3);
        if (code.startsWith('R') || code.startsWith('C')) {
          const arrow = rest.indexOf(' -> ');
          if (arrow !== -1) {
            return { status: code, path: rest.slice(arrow + 4), oldPath: rest.slice(0, arrow) };
          }
        }
        return { status: code, path: rest };
      });
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

/** GET /api/projects/:id/diff?file=path&source=git|session&chatId=X */
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

  if (source === 'git') {
    try {
      const diffArgs = file ? ['diff', '--', file] : ['diff'];
      const diff = await execGit(diffArgs, basePath);
      let original = '';
      if (file) {
        const headPath = oldPath || file;
        try {
          original = await execGit(['show', `HEAD:${headPath}`], basePath);
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
        modified = await readFile(resolvedFile, 'utf-8');
      }
      res.json({ diff, original, modified, source: 'git' });
    } catch (err) {
      if ((err as { code?: unknown }).code !== 128) {
        logger.warn({ err, basePath, file }, 'Failed to compute git diff');
      }
      res.json({ diff: '', original: '', modified: '', source: 'git' });
    }
  } else if (source === 'session') {
    if (!file) {
      const modifiedFiles = chatId ? ctx.db.chats.getModifiedFilesList(chatId) : [];
      res.json({ files: modifiedFiles, source: 'session' });
      return;
    }
    try {
      const resolvedFile = resolveAndValidatePath(basePath, file);
      if (!resolvedFile) {
        res.status(403).json({ error: 'Path outside project' });
        return;
      }
      let original = '';
      const headPath = oldPath || file;
      try {
        original = await execGit(['show', `HEAD:${headPath}`], basePath);
      } catch {
        /* new file */
      }
      const modified = await readFile(resolvedFile, 'utf-8');
      res.json({ original, modified, source: 'session', file });
    } catch (err) {
      logger.warn({ err, file }, 'Failed to read session diff file');
      res.status(404).json({ error: 'File not found' });
    }
  } else {
    res.status(400).json({ error: 'Invalid source. Use "git" or "session".' });
  }
}

export function gitRoutes(ctx: RouteContext): Router {
  const router = Router();

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
