/**
 * worktree-resolve.test.ts — unit tests for resolveWorktree.
 *
 * Behaviors covered:
 *  1.  Matches by anchored basename when dirName provided.
 *  2.  Does NOT match when dirName is only a suffix (no slash anchor).
 *  3.  Falls back to branchName match when dirName does not resolve.
 *  4.  Branch name containing "/" is found via branchName fallback, not dirName.
 *  5.  Returns undefined when neither dirName nor branchName matches.
 *  6.  dirName takes priority over branchName when both could match different entries.
 */
import { describe, it, expect } from 'vitest';
import { resolveWorktree } from '../worktree-resolve';

const worktrees = [
  { path: '/Users/alice/projects/myrepo', branch: 'main' },
  { path: '/Users/alice/projects/myrepo-wt/feat-login', branch: 'feat/login' },
  { path: '/Users/alice/projects/myrepo-wt/prefix-foo', branch: 'hotfix/foo' },
];

describe('resolveWorktree — anchored basename match', () => {
  it('resolves by anchored basename when dirName matches the last path segment', () => {
    const result = resolveWorktree(worktrees, { dirName: 'feat-login' });
    expect(result).toEqual(worktrees[1]);
  });

  it('does NOT match when dirName is a suffix but not the full basename segment', () => {
    // "foo" is a suffix of "prefix-foo" and "feat-login" but not a full segment
    const result = resolveWorktree(worktrees, { dirName: 'foo' });
    expect(result).toBeUndefined();
  });

  it('does NOT match when dirName contains "/" (not a valid basename)', () => {
    // feat/login is NOT the basename of .../feat-login; no match expected
    const result = resolveWorktree(worktrees, { dirName: 'feat/login' });
    expect(result).toBeUndefined();
  });
});

describe('resolveWorktree — branchName fallback', () => {
  it('falls back to branchName match when dirName does not resolve', () => {
    // dirName "nonexistent" won't match; branchName "feat/login" will
    const result = resolveWorktree(worktrees, { dirName: 'nonexistent', branchName: 'feat/login' });
    expect(result).toEqual(worktrees[1]);
  });

  it('resolves a branch name containing "/" via branchName fallback', () => {
    // "feat/login" can't be a dirname basename, so branchName is the only route
    const result = resolveWorktree(worktrees, { branchName: 'feat/login' });
    expect(result).toEqual(worktrees[1]);
  });

  it('returns undefined when neither dirName nor branchName matches', () => {
    const result = resolveWorktree(worktrees, { dirName: 'absent', branchName: 'gone/away' });
    expect(result).toBeUndefined();
  });
});

describe('resolveWorktree — dirName priority', () => {
  it('prefers dirName over branchName when both resolve different entries', () => {
    // dirName "feat-login" → index 1; branchName "hotfix/foo" → index 2
    const result = resolveWorktree(worktrees, { dirName: 'feat-login', branchName: 'hotfix/foo' });
    expect(result).toEqual(worktrees[1]);
  });
});
