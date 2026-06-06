import { describe, it, expect } from 'vitest';
import { type SessionItem } from '../../view-model/chat-to-thread-custom';
import { applySessionFilters, type SessionFilters } from '../apply-session-filters';
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

const PR = [{ url: 'u', owner: 'o', repo: 'r', number: 1, source: 'created' as const }];

const s1 = item('s1', 'proj-a', ['bug', 'urgent']);
const s2 = item('s2', 'proj-a', ['bug'], [], '/wt');
const s3 = item('s3', 'proj-b', ['perf'], PR);
const s4 = item('s4', 'proj-b', []);

// ---------------------------------------------------------------------------
// applySessionFilters
// ---------------------------------------------------------------------------

describe('applySessionFilters — no filters returns all', () => {
  it('returns all 4 items when no filters are active', () => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectId: null,
      selectedTags: new Set(),
      selectedSynthetic: new Set<SyntheticTag>(),
    });
    expect(result).toHaveLength(4);
  });
});

describe('applySessionFilters — project filter alone', () => {
  it('returns only items belonging to proj-a', () => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectId: 'proj-a',
      selectedTags: new Set(),
      selectedSynthetic: new Set<SyntheticTag>(),
    });
    expect(result.map((i) => i.id)).toEqual(['s1', 's2']);
  });
});

describe('applySessionFilters — single tag filter', () => {
  it('returns items that have the tag "bug"', () => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectId: null,
      selectedTags: new Set(['bug']),
      selectedSynthetic: new Set<SyntheticTag>(),
    });
    expect(result.map((i) => i.id)).toEqual(['s1', 's2']);
  });
});

describe('applySessionFilters — multiple tags AND-match', () => {
  it('returns only items that have both "bug" and "urgent"', () => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectId: null,
      selectedTags: new Set(['bug', 'urgent']),
      selectedSynthetic: new Set<SyntheticTag>(),
    });
    expect(result.map((i) => i.id)).toEqual(['s1']);
  });
});

describe('applySessionFilters — has-pr synthetic filter', () => {
  it('returns only items with detectedPrs', () => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectId: null,
      selectedTags: new Set(),
      selectedSynthetic: new Set<SyntheticTag>(['has-pr']),
    });
    expect(result.map((i) => i.id)).toEqual(['s3']);
  });
});

describe('applySessionFilters — has-worktree synthetic filter', () => {
  it('returns only items with a worktreePath', () => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectId: null,
      selectedTags: new Set(),
      selectedSynthetic: new Set<SyntheticTag>(['has-worktree']),
    });
    expect(result.map((i) => i.id)).toEqual(['s2']);
  });
});

describe('applySessionFilters — project + tag AND-match', () => {
  it('returns only proj-a items that also have "urgent"', () => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectId: 'proj-a',
      selectedTags: new Set(['urgent']),
      selectedSynthetic: new Set<SyntheticTag>(),
    });
    expect(result.map((i) => i.id)).toEqual(['s1']);
  });
});

describe('applySessionFilters — tag + synthetic AND-match', () => {
  it('returns only items that have "bug" AND have a worktreePath', () => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectId: null,
      selectedTags: new Set(['bug']),
      selectedSynthetic: new Set<SyntheticTag>(['has-worktree']),
    });
    expect(result.map((i) => i.id)).toEqual(['s2']);
  });
});

describe('applySessionFilters — empty result', () => {
  it('returns empty array when no items match project + tag combination', () => {
    const result = applySessionFilters([s1, s2, s3, s4], {
      filterProjectId: 'proj-a',
      selectedTags: new Set(['perf']),
      selectedSynthetic: new Set<SyntheticTag>(),
    });
    expect(result).toEqual([]);
  });
});

describe('applySessionFilters — has-pr excludes items with empty detectedPrs', () => {
  it('excludes s4 which has no detectedPrs when has-pr filter is active', () => {
    const result = applySessionFilters([s3, s4], {
      filterProjectId: null,
      selectedTags: new Set(),
      selectedSynthetic: new Set<SyntheticTag>(['has-pr']),
    });
    expect(result.map((i) => i.id)).toEqual(['s3']);
  });
});
