import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorktree, removeWorktree } from '../../workspace/worktree.js';

function getDefaultBranch(cwd: string): string {
  return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf-8' }).trim();
}

function initGitRepo(): { dir: string; defaultBranch: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'wt-test-'));
  execFileSync('git', ['init', dir], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.com'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'], { stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  const defaultBranch = getDefaultBranch(dir);
  execFileSync('git', ['branch', 'develop'], { cwd: dir, stdio: 'pipe' });
  return { dir, defaultBranch };
}

describe('createWorktree', () => {
  let repoDir: string;
  let defaultBranch: string;

  beforeEach(() => {
    const repo = initGitRepo();
    repoDir = repo.dir;
    defaultBranch = repo.defaultBranch;
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('creates worktree with explicit baseBranch and branchName', () => {
    const info = createWorktree(repoDir, 'test1234', '.worktrees', defaultBranch, 'feat/my-feature');
    expect(info.branchName).toBe('feat/my-feature');
    expect(info.worktreePath).toContain('.worktrees');

    // Verify the branch was created from the right base
    const log = execFileSync('git', ['log', '--oneline', '-1', 'feat/my-feature'], {
      cwd: repoDir,
      encoding: 'utf-8',
    });
    expect(log).toContain('init');

    removeWorktree(repoDir, info.worktreePath, info.branchName);
  });

  it('creates worktree from a non-default base branch', () => {
    // Add a commit on develop so it diverges from main
    execFileSync('git', ['checkout', 'develop'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'develop-commit'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['checkout', defaultBranch], { cwd: repoDir, stdio: 'pipe' });

    const info = createWorktree(repoDir, 'test5678', '.worktrees', 'develop', 'feat/from-develop');
    expect(info.branchName).toBe('feat/from-develop');

    const log = execFileSync('git', ['log', '--oneline', '-1', 'feat/from-develop'], {
      cwd: repoDir,
      encoding: 'utf-8',
    });
    expect(log).toContain('develop-commit');

    removeWorktree(repoDir, info.worktreePath, info.branchName);
  });

  it('uses sanitized branch name for worktree directory name', () => {
    const info = createWorktree(repoDir, 'abcdef12rest', '.worktrees', defaultBranch, 'session/abcdef12');
    expect(info.worktreePath).toContain('session-abcdef12');
    expect(info.worktreePath).not.toContain('abcdef12rest');
    removeWorktree(repoDir, info.worktreePath, info.branchName);
  });
});
