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
      transcriptMissing: false,
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

describe('tagsInUse', () => {
  it.each<[name: string, items: SessionItem[], projectId: string | null, expected: string[]]>([
    [
      'returns sorted deduped tags for items in the given project only',
      [s1, s2, s3],
      'proj-a',
      ['bug', 'docs', 'urgent'],
    ],
    [
      'returns sorted deduped tags across all items when projectId is null',
      [s1, s2, s3],
      null,
      ['bug', 'docs', 'perf', 'urgent'],
    ],
    ['returns empty array when no items belong to the given project', [s2], 'proj-a', []],
    [
      'returns tags sorted alphabetically regardless of input order',
      [item('s', 'proj-x', ['z-tag', 'a-tag', 'm-tag'])],
      'proj-x',
      ['a-tag', 'm-tag', 'z-tag'],
    ],
  ])('%s', (_name, items, projectId, expected) => {
    expect(tagsInUse(items, projectId)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// hasSynthetic
// ---------------------------------------------------------------------------

describe('hasSynthetic', () => {
  it.each<[name: string, items: SessionItem[], kind: SyntheticTag, expected: boolean]>([
    [
      "returns true when at least one item has a non-empty detectedPrs ('has-pr')",
      [
        item('s1', 'proj-a', [], []),
        item('s2', 'proj-b', [], [{ url: 'u', owner: 'o', repo: 'r', number: 1, source: 'created' }]),
      ],
      'has-pr',
      true,
    ],
    ["returns false when all items have empty detectedPrs ('has-pr')", [item('s1', 'proj-a', [], [])], 'has-pr', false],
    [
      "returns true when at least one item has a worktreePath ('has-worktree')",
      [item('s1', 'proj-a', []), item('s3', 'proj-b', [], [], '/wt/path')],
      'has-worktree',
      true,
    ],
    [
      "returns false when no item has a worktreePath ('has-worktree')",
      [item('s1', 'proj-a', []), item('s2', 'proj-b', [], [])],
      'has-worktree',
      false,
    ],
  ])('%s', (_name, items, kind, expected) => {
    expect(hasSynthetic(items, kind)).toBe(expected);
  });
});
