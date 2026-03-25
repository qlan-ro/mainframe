import { describe, it, expect } from 'vitest';
import { parseWorktreeList } from '../worktree.js';

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
