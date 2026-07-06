import { Router, type Request, type Response } from 'express';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import { ok, fail } from './respond.js';
import { asyncHandler } from './async-handler.js';
import { isWithinBase } from './path-utils.js';
import { GitService } from '../../git/git-service.js';
import { isNotGitRepo, parseStatusLines, parseDiffNameStatus } from '../../git/git-parse.js';
import { searchWithRipgrep } from '../ripgrep.js';
import { buildChurnSuggestions, buildTodoSuggestions, mergeSuggestions } from '../suggestions/build-suggestions.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:suggestions');

const TODO_MAX_RESULTS = 200;

/** Gather churn counts via GitService. Returns nulls/zeros for a non-git dir. */
async function gatherChurn(
  basePath: string,
): Promise<{ branch: string | null; baseBranch: string | null; workingFileCount: number; branchDiffCount: number }> {
  try {
    const svc = GitService.forProject(basePath);
    const branch = await svc.currentBranch();
    const status = await svc.statusRaw();
    const workingFileCount = parseStatusLines(status).length;

    const baseInfo = await svc.detectBaseBranch();
    let baseBranch: string | null = null;
    let branchDiffCount = 0;
    if (baseInfo && branch !== baseInfo.baseBranch) {
      baseBranch = baseInfo.baseBranch;
      const nameStatus = await svc.diff(['--name-status', `${baseInfo.mergeBase}..HEAD`]);
      branchDiffCount = parseDiffNameStatus(nameStatus).length;
    }
    return { branch, baseBranch, workingFileCount, branchDiffCount };
  } catch (err) {
    if (!isNotGitRepo(err)) logger.warn({ err, basePath }, 'Failed to gather churn signals');
    return { branch: null, baseBranch: null, workingFileCount: 0, branchDiffCount: 0 };
  }
}

/** Bounded TODO/FIXME scan, each hit re-contained under the canonical base. */
async function gatherTodoMatches(basePath: string): Promise<{ file: string }[]> {
  let realBase: string;
  try {
    realBase = await realpath(basePath);
  } catch {
    /* expected: base vanished */
    return [];
  }
  const hits = await searchWithRipgrep(realBase, 'TODO|FIXME', { maxResults: TODO_MAX_RESULTS });
  const out: { file: string }[] = [];
  for (const hit of hits) {
    const abs = path.resolve(realBase, hit.file);
    if (isWithinBase(realBase, abs)) out.push({ file: hit.file });
  }
  return out;
}

async function handleSuggestions(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'));
  if (!basePath) {
    fail(res, 404, 'Project not found');
    return;
  }
  try {
    const churnInput = await gatherChurn(basePath);
    // gatherChurn's branch is null only when basePath isn't a git repo (or git
    // failed) — skip the TODO scan too so a non-project directory never gets
    // ripgrepped for arbitrary matches.
    const todoMatches = churnInput.branch === null ? [] : await gatherTodoMatches(basePath);
    const churn = buildChurnSuggestions(churnInput);
    const todos = buildTodoSuggestions(todoMatches);
    ok(res, mergeSuggestions(churn, todos));
  } catch (err) {
    logger.warn({ err, basePath }, 'Failed to build suggestions');
    ok(res, []);
  }
}

export function suggestionRoutes(ctx: RouteContext): Router {
  const router = Router();
  router.get(
    '/api/projects/:id/suggestions',
    asyncHandler((req, res) => handleSuggestions(ctx, req, res)),
  );
  return router;
}
