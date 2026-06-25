import { describe, it, expect } from 'vitest';
import { type SessionItem } from '../../view-model/chat-to-thread-custom';
import { tagsInUse, hasSynthetic } from '../tags-in-use';
import type { SyntheticTag } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function item(
  id: string,
  projectId: string,
  tags: string[],
  detectedPrs: { url: string; owner: string; repo: string; number: number; source: 'created' | 'mentioned' }[] = [],
  worktreePath?: string,
): SessionItem {
  return {
    id,
    status: 'regular',
    custom: {
      projectId,
      adapterId: 'claude',
      tags,
      pinned: false,
      status: 'active',
      displayStatus: 'idle',
      hasPending: false,
      detectedPrs,
      worktreeMissing: false,
      updatedAt: 1748779200000,
      worktreePath,
    },
  };
}

// Reusable items used across multiple test cases
const s1 = item('s1', 'proj-a', ['bug', 'urgent']);
const s2 = item('s2', 'proj-b', ['perf']);
const s3 = item('s3', 'proj-a', ['bug', 'docs']);

// ---------------------------------------------------------------------------
// tagsInUse
// ---------------------------------------------------------------------------

describe('tagsInUse — project-scoped', () => {
  it('returns sorted deduped tags for items in the given project only', () => {
    expect(tagsInUse([s1, s2, s3], 'proj-a')).toEqual(['bug', 'docs', 'urgent']);
  });
});

describe('tagsInUse — null projectId = all items', () => {
  it('returns sorted deduped tags across all items when projectId is null', () => {
    expect(tagsInUse([s1, s2, s3], null)).toEqual(['bug', 'docs', 'perf', 'urgent']);
  });
});

describe('tagsInUse — no items in scope', () => {
  it('returns empty array when no items belong to the given project', () => {
    expect(tagsInUse([s2], 'proj-a')).toEqual([]);
  });
});

describe('tagsInUse — alphabetical sort', () => {
  it('returns tags sorted alphabetically regardless of input order', () => {
    const s = item('s', 'proj-x', ['z-tag', 'a-tag', 'm-tag']);
    expect(tagsInUse([s], 'proj-x')).toEqual(['a-tag', 'm-tag', 'z-tag']);
  });
});

// ---------------------------------------------------------------------------
// hasSynthetic — has-pr
// ---------------------------------------------------------------------------

describe("hasSynthetic — 'has-pr' true when any item has detectedPrs", () => {
  it('returns true when at least one item has a non-empty detectedPrs', () => {
    const withPr = item('s2', 'proj-b', [], [{ url: 'u', owner: 'o', repo: 'r', number: 1, source: 'created' }]);
    const noPr = item('s1', 'proj-a', [], []);
    const kind: SyntheticTag = 'has-pr';
    expect(hasSynthetic([noPr, withPr], kind)).toBe(true);
  });
});

describe("hasSynthetic — 'has-pr' false when no item has detectedPrs", () => {
  it('returns false when all items have empty detectedPrs', () => {
    const noPr = item('s1', 'proj-a', [], []);
    const kind: SyntheticTag = 'has-pr';
    expect(hasSynthetic([noPr], kind)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasSynthetic — has-worktree
// ---------------------------------------------------------------------------

describe("hasSynthetic — 'has-worktree' true when any item has a worktreePath", () => {
  it('returns true when at least one item has a worktreePath', () => {
    const noWt = item('s1', 'proj-a', []);
    const withWt = item('s3', 'proj-b', [], [], '/wt/path');
    const kind: SyntheticTag = 'has-worktree';
    expect(hasSynthetic([noWt, withWt], kind)).toBe(true);
  });
});

describe("hasSynthetic — 'has-worktree' false when no item has a worktreePath", () => {
  it('returns false when no item has a worktreePath', () => {
    const noWt1 = item('s1', 'proj-a', []);
    const noWt2 = item('s2', 'proj-b', [], []);
    const kind: SyntheticTag = 'has-worktree';
    expect(hasSynthetic([noWt1, noWt2], kind)).toBe(false);
  });
});
