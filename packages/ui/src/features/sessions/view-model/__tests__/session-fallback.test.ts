/**
 * pickArchiveFallback — pure selection of the session to land on after an archive.
 */
import { describe, it, expect } from 'vitest';
import type { SessionItem } from '../chat-to-thread-custom';
import { pickArchiveFallback } from '../session-fallback';

function item(id: string, updatedAt: number, projectId: string, status: 'regular' | 'archived' = 'regular'): SessionItem {
  return {
    id,
    remoteId: id,
    status,
    custom: {
      projectId,
      adapterId: 'claude',
      tags: [],
      pinned: false,
      status: 'active',
      displayStatus: 'idle',
      hasPending: false,
      detectedPrs: [],
      worktreeMissing: false,
      updatedAt,
    },
  } as unknown as SessionItem;
}

describe('pickArchiveFallback', () => {
  it('picks the most-recently-updated non-archived session', () => {
    const items = [item('a', 3000, 'p1', 'archived'), item('b', 1000, 'p1'), item('c', 2000, 'p1')];
    expect(pickArchiveFallback(items, null, null)).toBe('c');
  });

  it('prefers the last-used session when it is still live', () => {
    const items = [item('b', 1000, 'p1'), item('c', 2000, 'p1')];
    // preferred matches remoteId 'b' even though 'c' is newer.
    expect(pickArchiveFallback(items, null, 'b')).toBe('b');
  });

  it('stays within the active project filter, widening only when it has none left', () => {
    const items = [item('a', 4000, 'p1', 'archived'), item('b', 1000, 'p1'), item('other', 9000, 'p2')];
    expect(pickArchiveFallback(items, 'p1', null)).toBe('b');
    // p3 has no sessions → widen to the newest overall non-archived.
    expect(pickArchiveFallback(items, 'p3', null)).toBe('other');
  });

  it('returns null when nothing non-archived remains', () => {
    const items = [item('a', 4000, 'p1', 'archived')];
    expect(pickArchiveFallback(items, null, null)).toBeNull();
  });
});
