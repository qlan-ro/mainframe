import { describe, it, expect } from 'vitest';
import { worktreeBasename } from '../worktree-basename';

describe('worktreeBasename', () => {
  it('returns the trailing path segment', () => {
    expect(worktreeBasename('/repos/mf/.git/worktrees/feat-x')).toBe('feat-x');
  });

  it('ignores a trailing slash', () => {
    expect(worktreeBasename('/repos/mf/.git/worktrees/feat-x/')).toBe('feat-x');
  });

  it('returns the whole string when there is no slash', () => {
    expect(worktreeBasename('feat-x')).toBe('feat-x');
  });
});
