import { describe, it, expect } from 'vitest';
import type { SessionItem } from '../chat-to-thread-custom';
import { attentionCount } from '../attention-counts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function item(id: string, projectId: string, hasPending = false): SessionItem {
  return {
    id,
    status: 'regular',
    custom: {
      projectId,
      adapterId: 'claude',
      tags: [],
      pinned: false,
      status: 'active',
      displayStatus: hasPending ? 'waiting' : 'idle',
      hasPending,
      detectedPrs: [],
      worktreeMissing: false,
      transcriptMissing: false,
      updatedAt: 1748779200000,
    },
  };
}

// ---------------------------------------------------------------------------
// attentionCount — counts unread items in project
// ---------------------------------------------------------------------------

describe('attentionCount — counts unread items in project', () => {
  it('returns 1 when only s1 is unread and s2 is not, s3 is in another project', () => {
    const s1 = item('s1', 'proj-a', false);
    const s2 = item('s2', 'proj-a', false);
    const s3 = item('s3', 'proj-b', false);
    const isUnread = (id: string) => id === 's1';
    expect(attentionCount([s1, s2, s3], isUnread, 'proj-a')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// attentionCount — counts pending items in project
// ---------------------------------------------------------------------------

describe('attentionCount — counts pending items in project', () => {
  it('returns 1 when s1 has a pending permission and s2 does not', () => {
    const s1 = item('s1', 'proj-a', true);
    const s2 = item('s2', 'proj-a', false);
    expect(attentionCount([s1, s2], () => false, 'proj-a')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// attentionCount — OR semantics: unread + pending on same item counts once
// ---------------------------------------------------------------------------

describe('attentionCount — OR semantics', () => {
  it('counts s1 once even when it is both unread and has a pending permission', () => {
    const s1 = item('s1', 'proj-a', true);
    const isUnread = (id: string) => id === 's1';
    expect(attentionCount([s1], isUnread, 'proj-a')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// attentionCount — items from other project not counted
// ---------------------------------------------------------------------------

describe('attentionCount — items from other project not counted', () => {
  it('returns 0 when s1 is in proj-a (not unread/pending) and s2 pending is in proj-b', () => {
    const s1 = item('s1', 'proj-a', false);
    const s2 = item('s2', 'proj-b', true);
    expect(attentionCount([s1, s2], () => false, 'proj-a')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// attentionCount — zero when no items match
// ---------------------------------------------------------------------------

describe('attentionCount — zero when no items match', () => {
  it('returns 0 for an empty items array', () => {
    expect(attentionCount([], () => false, 'proj-a')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// attentionCount — multiple matching items summed
// ---------------------------------------------------------------------------

describe('attentionCount — multiple matching items summed', () => {
  it('returns 3 when s1 and s2 have pending and s3 is unread, all in proj-a', () => {
    const s1 = item('s1', 'proj-a', true);
    const s2 = item('s2', 'proj-a', true);
    const s3 = item('s3', 'proj-a', false);
    const isUnread = (id: string) => id === 's3';
    expect(attentionCount([s1, s2, s3], isUnread, 'proj-a')).toBe(3);
  });
});
