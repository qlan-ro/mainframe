import { describe, it, expect } from 'vitest';
import { type SessionItem } from '../../view-model/chat-to-thread-custom';
import { applySessionFilters } from '../apply-session-filters';
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

const PR = [{ url: 'u', owner: 'o', repo: 'r', number: 1, source: 'created' as const }];

const s1 = item('s1', 'proj-a', ['bug', 'urgent']);
const s2 = item('s2', 'proj-a', ['bug'], [], '/wt');
const s3 = item('s3', 'proj-b', ['perf'], PR);
const s4 = item('s4', 'proj-c', []);

// ---------------------------------------------------------------------------
// applySessionFilters
// ---------------------------------------------------------------------------

type Case = [
  name: string,
  filterProjectIds: string[],
  tags: string[],
  synthetic: SyntheticTag[],
  expectedIds: string[],
];

describe('applySessionFilters — single filter dimension', () => {
  it.each<Case>([
    ['returns all 4 items when no filters are active (empty project scope)', [], [], [], ['s1', 's2', 's3', 's4']],
    ['returns only items belonging to proj-a', ['proj-a'], [], [], ['s1', 's2']],
    ['returns items that have the tag "bug"', [], ['bug'], [], ['s1', 's2']],
    ['returns only items that have both "bug" and "urgent"', [], ['bug', 'urgent'], [], ['s1']],
    ['returns only items with detectedPrs (has-pr)', [], [], ['has-pr'], ['s3']],
    ['returns only items with a worktreePath (has-worktree)', [], [], ['has-worktree'], ['s2']],
  ])('%s', (_name, filterProjectIds, tags, synthetic, expectedIds) => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectIds: new Set(filterProjectIds),
      selectedTags: new Set(tags),
      selectedSynthetic: new Set<SyntheticTag>(synthetic),
    });
    expect(result.map((i) => i.id)).toEqual(expectedIds);
  });
});

describe('applySessionFilters — multi-project scope', () => {
  it('keeps items from any of two scoped projects, excluding a third', () => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectIds: new Set(['proj-a', 'proj-b']),
      selectedTags: new Set(),
      selectedSynthetic: new Set(),
    });
    expect(result.map((i) => i.id)).toEqual(['s1', 's2', 's3']);
  });

  it('keeps items from all three projects when the scope names all of them', () => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectIds: new Set(['proj-a', 'proj-b', 'proj-c']),
      selectedTags: new Set(),
      selectedSynthetic: new Set(),
    });
    expect(result.map((i) => i.id)).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('returns no items when the scope names projects none of the items belong to', () => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectIds: new Set(['proj-x', 'proj-y']),
      selectedTags: new Set(),
      selectedSynthetic: new Set(),
    });
    expect(result).toEqual([]);
  });
});

describe('applySessionFilters — cross-dimension AND-match', () => {
  it.each<Case>([
    ['returns only proj-a items that also have "urgent"', ['proj-a'], ['urgent'], [], ['s1']],
    ['returns only items that have "bug" AND have a worktreePath', [], ['bug'], ['has-worktree'], ['s2']],
    ['returns empty array when no items match project + tag combination', ['proj-a'], ['perf'], [], []],
    ['combines a two-project scope with a tag filter', ['proj-a', 'proj-b'], ['perf'], [], ['s3']],
  ])('%s', (_name, filterProjectIds, tags, synthetic, expectedIds) => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectIds: new Set(filterProjectIds),
      selectedTags: new Set(tags),
      selectedSynthetic: new Set<SyntheticTag>(synthetic),
    });
    expect(result.map((i) => i.id)).toEqual(expectedIds);
  });
});
