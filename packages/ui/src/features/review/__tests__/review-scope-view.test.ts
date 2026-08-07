/**
 * review-scope-view tests — the pure half of the review modal's scope switcher.
 *
 * Every expectation is a stated literal; nothing here re-derives the labels or
 * the comparison string from the module's own tables.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SCOPE, SCOPE_OPTIONS, scopeHeaderView } from '../review-scope-view';

const BRANCH_SOURCE = { branch: 'feat/x', baseBranch: 'main', mergeBase: 'abc1234def5678' };
const NO_BRANCH_SOURCE = { branch: null, baseBranch: null, mergeBase: null };

describe('SCOPE_OPTIONS', () => {
  it('offers Session, Uncommitted and Branch in that order', () => {
    expect(SCOPE_OPTIONS).toEqual([
      { id: 'session', label: 'Session' },
      { id: 'uncommitted', label: 'Uncommitted' },
      { id: 'branch', label: 'Branch' },
    ]);
  });

  it('defaults to uncommitted — the scope the panel Changes row counts', () => {
    expect(DEFAULT_SCOPE).toBe('uncommitted');
  });
});

describe('scopeHeaderView — totals', () => {
  it('shows the +/− totals on uncommitted', () => {
    expect(scopeHeaderView('uncommitted', NO_BRANCH_SOURCE).showTotals).toBe(true);
  });

  it('hides them on session, which reports paths only', () => {
    expect(scopeHeaderView('session', NO_BRANCH_SOURCE).showTotals).toBe(false);
  });

  it('hides them on branch, which reports per-file status but no counts', () => {
    expect(scopeHeaderView('branch', BRANCH_SOURCE).showTotals).toBe(false);
  });
});

describe('scopeHeaderView — comparison line', () => {
  it('reads branch ↔ base · short merge base on the branch scope', () => {
    expect(scopeHeaderView('branch', BRANCH_SOURCE).compareLine).toBe('feat/x ↔ main · abc1234');
  });

  it('drops the merge base when the daemon did not report one', () => {
    expect(scopeHeaderView('branch', { branch: 'feat/x', baseBranch: 'main', mergeBase: null }).compareLine).toBe(
      'feat/x ↔ main',
    );
  });

  it('is null while either end of the comparison is unknown', () => {
    expect(scopeHeaderView('branch', { branch: 'feat/x', baseBranch: null, mergeBase: 'abc' }).compareLine).toBeNull();
    expect(scopeHeaderView('branch', { branch: null, baseBranch: 'main', mergeBase: 'abc' }).compareLine).toBeNull();
  });

  it('is null on the other two scopes even when a base is known', () => {
    expect(scopeHeaderView('uncommitted', BRANCH_SOURCE).compareLine).toBeNull();
    expect(scopeHeaderView('session', BRANCH_SOURCE).compareLine).toBeNull();
  });
});
