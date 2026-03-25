import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WorktreeEntry {
  path: string;
  branch: string | null;
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
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: projectPath,
    });
    return parseWorktreeList(stdout);
  } catch {
    return [];
  }
}

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
}

export function isGitRepo(projectPath: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function createWorktree(projectPath: string, chatId: string, dirName = '.worktrees'): WorktreeInfo {
  const shortId = chatId.slice(0, 8);
  const branchName = `session/${shortId}`;
  const worktreeDir = path.join(projectPath, dirName);
  const worktreePath = path.join(worktreeDir, shortId);

  mkdirSync(worktreeDir, { recursive: true });
  execFileSync('git', ['worktree', 'add', '-b', branchName, worktreePath], {
    cwd: projectPath,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  return { worktreePath, branchName };
}

export function removeWorktree(projectPath: string, worktreePath: string, branchName: string): void {
  try {
    execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true });
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
    } catch {}
  }
  try {
    execFileSync('git', ['branch', '-D', branchName], { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
  } catch {}
}
