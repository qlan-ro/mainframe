/**
 * branch-grouping.test.ts — pure helper unit tests with hardcoded expectations.
 *
 * Behaviors covered:
 *  groupBranches:
 *   1. Branches with a slash are placed in a prefix group.
 *   2. Branches without a slash are placed in ungrouped.
 *   3. Two branches sharing the same prefix land in the same group.
 *   4. Empty list produces empty groups and empty ungrouped.
 *   5. A branch named exactly "feat" (no slash) is ungrouped.
 *
 *  filterBranches:
 *   6. Empty search returns all branches.
 *   7. Case-insensitive match on a substring.
 *   8. No match produces an empty array.
 *   9. Exact-match query returns only the matching branch.
 *
 *  filterRemote:
 *  10. Empty search returns all remote names.
 *  11. Case-insensitive match on a substring.
 *  12. No match produces an empty array.
 *
 *  BRANCH_NAME_RE:
 *  13. Valid names pass: 'main', 'feat/my-branch', 'fix.1', 'a1_b'.
 *  14. Invalid names fail: starts with '-', empty string, starts with '/'.
 */
import { describe, it, expect } from 'vitest';
import { groupBranches, filterBranches, filterRemote, BRANCH_NAME_RE } from '../branch-grouping';
import type { BranchInfo } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function branch(name: string, current = false): BranchInfo {
  return { name, current };
}

// ---------------------------------------------------------------------------
// groupBranches
// ---------------------------------------------------------------------------

describe('groupBranches', () => {
  it('places a branch with a slash into a prefix group', () => {
    const { groups, ungrouped } = groupBranches([branch('feat/login')]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.prefix).toBe('feat');
    expect(groups[0]?.branches).toHaveLength(1);
    expect(groups[0]?.branches[0]?.name).toBe('feat/login');
    expect(ungrouped).toHaveLength(0);
  });

  it('places a branch without a slash into ungrouped', () => {
    const { groups, ungrouped } = groupBranches([branch('main')]);

    expect(groups).toHaveLength(0);
    expect(ungrouped).toHaveLength(1);
    expect(ungrouped[0]?.name).toBe('main');
  });

  it('puts two branches sharing the same prefix into one group', () => {
    const { groups, ungrouped } = groupBranches([branch('feat/a'), branch('feat/b'), branch('main')]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.prefix).toBe('feat');
    expect(groups[0]?.branches).toHaveLength(2);
    expect(groups[0]?.branches.map((b) => b.name)).toEqual(['feat/a', 'feat/b']);
    expect(ungrouped).toHaveLength(1);
    expect(ungrouped[0]?.name).toBe('main');
  });

  it('returns empty groups and ungrouped for an empty list', () => {
    const { groups, ungrouped } = groupBranches([]);

    expect(groups).toEqual([]);
    expect(ungrouped).toEqual([]);
  });

  it('puts a branch named exactly "feat" (no slash) into ungrouped, not a group', () => {
    const { groups, ungrouped } = groupBranches([branch('feat')]);

    expect(groups).toHaveLength(0);
    expect(ungrouped).toHaveLength(1);
    expect(ungrouped[0]?.name).toBe('feat');
  });

  it('creates separate groups for different prefixes', () => {
    const input = [branch('feat/a'), branch('fix/b'), branch('main')];
    const { groups, ungrouped } = groupBranches(input);

    const prefixes = groups.map((g) => g.prefix).sort();
    expect(prefixes).toEqual(['feat', 'fix']);
    expect(ungrouped).toHaveLength(1);
    expect(ungrouped[0]?.name).toBe('main');
  });
});

// ---------------------------------------------------------------------------
// filterBranches
// ---------------------------------------------------------------------------

describe('filterBranches', () => {
  const BRANCHES: BranchInfo[] = [branch('main'), branch('feat/login'), branch('feat/signup'), branch('fix/header')];

  it('returns all branches when search is an empty string', () => {
    const result = filterBranches(BRANCHES, '');

    expect(result).toHaveLength(4);
    expect(result.map((b) => b.name)).toEqual(['main', 'feat/login', 'feat/signup', 'fix/header']);
  });

  it('matches case-insensitively on a substring', () => {
    const result = filterBranches(BRANCHES, 'FEAT');

    expect(result).toHaveLength(2);
    expect(result.map((b) => b.name)).toEqual(['feat/login', 'feat/signup']);
  });

  it('returns an empty array when no branch matches', () => {
    const result = filterBranches(BRANCHES, 'zzz');

    expect(result).toEqual([]);
  });

  it('returns only the exact-matching branch when search is its full name', () => {
    const result = filterBranches(BRANCHES, 'main');

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('main');
  });
});

// ---------------------------------------------------------------------------
// filterRemote
// ---------------------------------------------------------------------------

describe('filterRemote', () => {
  const REMOTES = ['origin/main', 'origin/feat', 'upstream/main'];

  it('returns all remote names when search is an empty string', () => {
    const result = filterRemote(REMOTES, '');

    expect(result).toEqual(['origin/main', 'origin/feat', 'upstream/main']);
  });

  it('filters case-insensitively on a substring', () => {
    const result = filterRemote(REMOTES, 'ORIGIN');

    expect(result).toEqual(['origin/main', 'origin/feat']);
  });

  it('returns an empty array when no remote name matches', () => {
    const result = filterRemote(REMOTES, 'xyz');

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BRANCH_NAME_RE
// ---------------------------------------------------------------------------

describe('BRANCH_NAME_RE', () => {
  it.each([['main'], ['feat/my-branch'], ['fix.1'], ['a1_b'], ['feature/FOO-123'], ['1.0.0']])(
    'accepts valid branch name "%s"',
    (name) => {
      expect(BRANCH_NAME_RE.test(name)).toBe(true);
    },
  );

  it.each([['-starts-with-dash'], [''], ['/starts-with-slash'], ['has space'], ['has~tilde']])(
    'rejects invalid branch name "%s"',
    (name) => {
      expect(BRANCH_NAME_RE.test(name)).toBe(false);
    },
  );
});
