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

type IsUnread = (id: string) => boolean;
const NEVER_UNREAD: IsUnread = () => false;

describe('attentionCount — per-item signal', () => {
  it.each<[name: string, items: SessionItem[], isUnread: IsUnread, expected: number]>([
    [
      'returns 1 when only s1 is unread and s2 is not, s3 is in another project',
      [item('s1', 'proj-a', false), item('s2', 'proj-a', false), item('s3', 'proj-b', false)],
      (id) => id === 's1',
      1,
    ],
    [
      'returns 1 when s1 has a pending permission and s2 does not',
      [item('s1', 'proj-a', true), item('s2', 'proj-a', false)],
      NEVER_UNREAD,
      1,
    ],
    [
      'counts s1 once even when it is both unread and has a pending permission',
      [item('s1', 'proj-a', true)],
      (id) => id === 's1',
      1,
    ],
    ['returns 0 for an empty items array', [], NEVER_UNREAD, 0],
  ])('%s', (_name, items, isUnread, expected) => {
    expect(attentionCount(items, isUnread, 'proj-a')).toBe(expected);
  });
});

describe('attentionCount — project scoping and summing', () => {
  it.each<[name: string, items: SessionItem[], isUnread: IsUnread, expected: number]>([
    [
      'returns 0 when s1 is in proj-a (not unread/pending) and s2 pending is in proj-b',
      [item('s1', 'proj-a', false), item('s2', 'proj-b', true)],
      NEVER_UNREAD,
      0,
    ],
    [
      'returns 3 when s1 and s2 have pending and s3 is unread, all in proj-a',
      [item('s1', 'proj-a', true), item('s2', 'proj-a', true), item('s3', 'proj-a', false)],
      (id) => id === 's3',
      3,
    ],
  ])('%s', (_name, items, isUnread, expected) => {
    expect(attentionCount(items, isUnread, 'proj-a')).toBe(expected);
  });
});
