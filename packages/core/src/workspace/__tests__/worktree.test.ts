import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWorktreeList, isWorktreePresent } from '../worktree.js';

describe('isWorktreePresent', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wt-present-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns true for a linked worktree (dir with a .git file pointer)', async () => {
    const wt = join(dir, 'linked');
    await mkdir(wt);
    await writeFile(join(wt, '.git'), 'gitdir: /repo/.git/worktrees/linked\n');
    expect(isWorktreePresent(wt)).toBe(true);
  });

  it('returns true for the main checkout (dir with a .git directory)', async () => {
    const repo = join(dir, 'repo');
    await mkdir(join(repo, '.git'), { recursive: true });
    expect(isWorktreePresent(repo)).toBe(true);
  });

  it('returns false for an orphaned stub dir that has no .git entry', async () => {
    const stub = join(dir, 'agent-stub');
    await mkdir(stub);
    expect(isWorktreePresent(stub)).toBe(false);
  });

  it('returns false for a path that does not exist', () => {
    expect(isWorktreePresent(join(dir, 'nope'))).toBe(false);
  });
});

describe('parseWorktreeList', () => {
  it('parses porcelain output into worktree entries', () => {
    const output = [
      'worktree /Users/dev/my-project',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree /Users/dev/my-project/.worktrees/feat-x',
      'HEAD def5678',
      'branch refs/heads/feat-x',
      '',
    ].join('\n');

    const entries = parseWorktreeList(output);
    expect(entries).toEqual([
      { path: '/Users/dev/my-project', branch: 'refs/heads/main' },
      { path: '/Users/dev/my-project/.worktrees/feat-x', branch: 'refs/heads/feat-x' },
    ]);
  });

  it('handles detached HEAD entries', () => {
    const output = [
      'worktree /Users/dev/repo',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree /Users/dev/repo/.worktrees/detached',
      'HEAD def5678',
      'detached',
      '',
    ].join('\n');

    const entries = parseWorktreeList(output);
    expect(entries).toEqual([
      { path: '/Users/dev/repo', branch: 'refs/heads/main' },
      { path: '/Users/dev/repo/.worktrees/detached', branch: null },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parseWorktreeList('')).toEqual([]);
  });
});
