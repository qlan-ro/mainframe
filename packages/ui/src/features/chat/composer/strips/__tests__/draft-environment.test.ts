import { describe, it, expect } from 'vitest';
import type { DraftCfg } from '@/features/sessions/runtime/draft-config';
import { draftEnvironment, environmentPatch, suggestBranchName } from '../draft-environment';

const draft = (overrides: Partial<DraftCfg> = {}): DraftCfg => ({ projectId: 'p1', adapterId: 'claude', ...overrides });

describe('draftEnvironment', () => {
  it('is local for a plain draft', () => {
    expect(draftEnvironment(draft())).toEqual({ kind: 'local' });
  });

  it('is temporary when the draft is marked temporary', () => {
    expect(draftEnvironment(draft({ temporary: true }))).toEqual({ kind: 'temporary' });
  });

  it('reads a new worktree off pendingWorktree', () => {
    expect(draftEnvironment(draft({ pendingWorktree: { baseBranch: 'main', branchName: 'session-1' } }))).toEqual({
      kind: 'new-worktree',
      base: 'main',
      branchName: 'session-1',
    });
  });

  it('reads an attached worktree off its path and branch', () => {
    expect(draftEnvironment(draft({ worktreePath: '/wt/a', branchName: 'feat-a' }))).toEqual({
      kind: 'worktree',
      branch: 'feat-a',
      path: '/wt/a',
    });
  });

  it('names a worktree without a branch "detached"', () => {
    expect(draftEnvironment(draft({ worktreePath: '/wt/a' }))).toEqual({
      kind: 'worktree',
      branch: 'detached',
      path: '/wt/a',
    });
  });

  it('prefers a pending new worktree over a temporary flag', () => {
    expect(
      draftEnvironment(draft({ temporary: true, pendingWorktree: { baseBranch: 'main', branchName: 'x' } })).kind,
    ).toBe('new-worktree');
  });
});

describe('environmentPatch', () => {
  it('local clears every environment field', () => {
    expect(environmentPatch({ kind: 'local' })).toEqual({
      worktreePath: undefined,
      branchName: undefined,
      pendingWorktree: undefined,
      temporary: false,
    });
  });

  it('temporary clears the worktree and sets the flag', () => {
    expect(environmentPatch({ kind: 'temporary' })).toEqual({
      worktreePath: undefined,
      branchName: undefined,
      pendingWorktree: undefined,
      temporary: true,
    });
  });

  it('a new worktree clears temporary and any attached path', () => {
    expect(environmentPatch({ kind: 'new-worktree', base: 'main', branchName: 'session-1' })).toEqual({
      worktreePath: undefined,
      branchName: undefined,
      pendingWorktree: { baseBranch: 'main', branchName: 'session-1' },
      temporary: false,
    });
  });

  it('an attached worktree clears temporary and any pending one', () => {
    expect(environmentPatch({ kind: 'worktree', branch: 'feat-a', path: '/wt/a' })).toEqual({
      worktreePath: '/wt/a',
      branchName: 'feat-a',
      pendingWorktree: undefined,
      temporary: false,
    });
  });
});

describe('suggestBranchName', () => {
  it('starts at session-1', () => {
    expect(suggestBranchName([])).toBe('session-1');
  });

  it('skips taken names', () => {
    expect(suggestBranchName(['session-1', 'session-2', 'other'])).toBe('session-3');
  });

  it('fills a gap', () => {
    expect(suggestBranchName(['session-2'])).toBe('session-1');
  });
});
