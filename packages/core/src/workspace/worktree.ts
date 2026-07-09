import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ProjectsRepository } from '../db/projects.js';
import { createChildLogger } from '../logger.js';
import { execGit } from '../server/routes/exec-git.js';

const log = createChildLogger('worktree-backfill');

export interface WorktreeEntry {
  path: string;
  branch: string | null;
}

/**
 * True when `worktreePath` is a usable git worktree: the directory exists AND
 * carries a `.git` entry — a file pointer for a linked worktree, a directory
 * for the main checkout. Guards against orphaned stub dirs left behind when a
 * worktree is removed: those still pass a bare existence check but hold none of
 * the repo's files, so any read/diff under them resolves to a dead path.
 */
export function isWorktreePresent(worktreePath: string): boolean {
  return existsSync(worktreePath) && existsSync(path.join(worktreePath, '.git'));
}

export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  const lines = output.split('\n');
  let currentPath: string | null = null;
  let currentBranch: string | null = null;

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length);
      currentBranch = null;
    } else if (line.startsWith('branch ')) {
      currentBranch = line.slice('branch '.length);
    } else if (line === 'detached') {
      currentBranch = null;
    } else if (line === '' && currentPath !== null) {
      entries.push({ path: currentPath, branch: currentBranch });
      currentPath = null;
      currentBranch = null;
    }
  }

  return entries;
}

export async function getWorktrees(projectPath: string): Promise<WorktreeEntry[]> {
  try {
    const stdout = await execGit(['worktree', 'list', '--porcelain'], projectPath);
    return parseWorktreeList(stdout);
  } catch {
    /* best-effort: not a git repo / no worktrees */
    return [];
  }
}

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
}

export async function createWorktree(
  projectPath: string,
  dirName: string,
  baseBranch: string,
  branchName: string,
): Promise<WorktreeInfo> {
  const sanitizedBranch = branchName.replace(/\//g, '-');
  const worktreeDir = path.join(projectPath, dirName);
  const worktreePath = path.join(worktreeDir, sanitizedBranch);

  await mkdir(worktreeDir, { recursive: true });
  // No timeout: `worktree add` can clone/checkout a large tree and run hooks,
  // which legitimately exceeds the default 30s cap (the previous sync impl had
  // no timeout either).
  await execGit(['worktree', 'add', '-b', branchName, worktreePath, baseBranch], projectPath, { timeout: 0 });
  return { worktreePath, branchName };
}

export async function backfillWorktreeRelationships(projects: ProjectsRepository): Promise<void> {
  const allProjects = projects.list();
  const pathToId = new Map(allProjects.map((p) => [p.path, p.id]));

  for (const project of allProjects) {
    if (project.parentProjectId) continue;
    const worktrees = await getWorktrees(project.path);
    for (const wt of worktrees) {
      if (wt.path === project.path) continue;
      const childId = pathToId.get(wt.path);
      if (childId) {
        const child = allProjects.find((p) => p.id === childId);
        if (child && !child.parentProjectId) {
          log.info({ childId, parentId: project.id, path: wt.path }, 'Backfilling worktree relationship');
          projects.setParentProject(childId, project.id);
        }
      }
    }
  }
}

export async function branchExists(projectPath: string, branchName: string): Promise<boolean> {
  try {
    await execGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`], projectPath);
    return true;
  } catch {
    /* expected: branch missing */
    return false;
  }
}

/** Re-add a previously deleted worktree at its original path, checking out an existing branch. */
export async function addWorktreeForBranch(
  projectPath: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  try {
    // Drop the stale registration git still holds for the deleted directory.
    await execGit(['worktree', 'prune'], projectPath);
  } catch {
    /* best-effort */
  }
  // No timeout: checkout of a large tree can exceed the default cap (see createWorktree).
  await execGit(['worktree', 'add', worktreePath, branchName], projectPath, { timeout: 0 });
}

export async function removeWorktree(projectPath: string, worktreePath: string, branchName: string): Promise<void> {
  try {
    await execGit(['worktree', 'remove', worktreePath, '--force'], projectPath);
  } catch {
    try {
      await rm(worktreePath, { recursive: true, force: true });
    } catch {
      /* best-effort: worktree dir may already be gone */
    }
    try {
      await execGit(['worktree', 'prune'], projectPath);
    } catch {
      /* best-effort */
    }
  }
  // best-effort: branch may not exist or may still be checked out in another worktree
  try {
    await execGit(['branch', '-D', branchName], projectPath);
  } catch {
    /* best-effort */
  }
}
