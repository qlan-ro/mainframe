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
const s4 = item('s4', 'proj-b', []);

// ---------------------------------------------------------------------------
// applySessionFilters
// ---------------------------------------------------------------------------

type Case = [
  name: string,
  filterProjectId: string | null,
  tags: string[],
  synthetic: SyntheticTag[],
  expectedIds: string[],
];

describe('applySessionFilters — single filter dimension', () => {
  it.each<Case>([
    ['returns all 4 items when no filters are active', null, [], [], ['s1', 's2', 's3', 's4']],
    ['returns only items belonging to proj-a', 'proj-a', [], [], ['s1', 's2']],
    ['returns items that have the tag "bug"', null, ['bug'], [], ['s1', 's2']],
    ['returns only items that have both "bug" and "urgent"', null, ['bug', 'urgent'], [], ['s1']],
    ['returns only items with detectedPrs (has-pr)', null, [], ['has-pr'], ['s3']],
    ['returns only items with a worktreePath (has-worktree)', null, [], ['has-worktree'], ['s2']],
  ])('%s', (_name, filterProjectId, tags, synthetic, expectedIds) => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectId,
      selectedTags: new Set(tags),
      selectedSynthetic: new Set<SyntheticTag>(synthetic),
    });
    expect(result.map((i) => i.id)).toEqual(expectedIds);
  });
});

describe('applySessionFilters — cross-dimension AND-match', () => {
  it.each<Case>([
    ['returns only proj-a items that also have "urgent"', 'proj-a', ['urgent'], [], ['s1']],
    ['returns only items that have "bug" AND have a worktreePath', null, ['bug'], ['has-worktree'], ['s2']],
    ['returns empty array when no items match project + tag combination', 'proj-a', ['perf'], [], []],
  ])('%s', (_name, filterProjectId, tags, synthetic, expectedIds) => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectId,
      selectedTags: new Set(tags),
      selectedSynthetic: new Set<SyntheticTag>(synthetic),
    });
    expect(result.map((i) => i.id)).toEqual(expectedIds);
  });
});
