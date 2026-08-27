import { describe, it, expect } from 'vitest';
import type { SessionItem, SessionCustom } from '../chat-to-thread-custom';
import { pickInitialSession } from '../initial-session';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function item(
  id: string,
  overrides: Partial<SessionCustom> & { status?: SessionItem['status']; remoteId?: string } = {},
): SessionItem {
  const { status = 'regular', remoteId, ...customOverrides } = overrides;
  return {
    id,
    remoteId,
    title: `Session ${id}`,
    status,
    custom: {
      projectId: 'proj-a',
      adapterId: 'claude',
      tags: [],
      pinned: false,
      status: 'active',
      displayStatus: 'idle',
      hasPending: false,
      detectedPrs: [],
      worktreeMissing: false,
      transcriptMissing: false,
      updatedAt: 1000,
      ...customOverrides,
    },
  };
}

// ---------------------------------------------------------------------------
// pickInitialSession — returns the most-recently-updated non-archived id
// ---------------------------------------------------------------------------

describe('pickInitialSession — returns the most-recently-updated non-archived id', () => {
  it('picks the id with the largest updatedAt among several non-archived items', () => {
    const items = [
      item('oldest', { updatedAt: 1000 }),
      item('newest', { updatedAt: 3000 }),
      item('middle', { updatedAt: 2000 }),
    ];
    expect(pickInitialSession(items)).toBe('newest');
  });
});

// ---------------------------------------------------------------------------
// pickInitialSession — skips archived items
// ---------------------------------------------------------------------------

describe('pickInitialSession — skips archived items even when they have the largest updatedAt', () => {
  it('returns the most-recent non-archived id when the archived item has the largest updatedAt', () => {
    const items = [
      item('regular-old', { updatedAt: 1000 }),
      item('regular-recent', { updatedAt: 2000 }),
      item('archived-newest', { status: 'archived', updatedAt: 9999 }),
    ];
    expect(pickInitialSession(items)).toBe('regular-recent');
  });
});

// ---------------------------------------------------------------------------
// pickInitialSession — returns null for empty array
// ---------------------------------------------------------------------------

describe('pickInitialSession — returns null for an empty array', () => {
  it('returns null when items is empty', () => {
    expect(pickInitialSession([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pickInitialSession — returns null when all items are archived
// ---------------------------------------------------------------------------

describe('pickInitialSession — returns null when every item is archived', () => {
  it('returns null when all items have status archived', () => {
    const items = [
      item('arc-a', { status: 'archived', updatedAt: 1000 }),
      item('arc-b', { status: 'archived', updatedAt: 2000 }),
    ];
    expect(pickInitialSession(items)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pickInitialSession — restores the persisted last session (preferredRemoteId)
// ---------------------------------------------------------------------------

describe('pickInitialSession — restores the last open session by remoteId', () => {
  it('returns the thread id of the item whose remoteId matches, over the most-recent', () => {
    const items = [
      item('thread-old', { remoteId: 'chat-old', updatedAt: 1000 }),
      item('thread-new', { remoteId: 'chat-new', updatedAt: 3000 }),
    ];
    // chat-old is older but it was the last one open → restore it.
    expect(pickInitialSession(items, 'chat-old')).toBe('thread-old');
  });

  it('matches on remoteId, not the aui thread id (which may be a __LOCALID_* value)', () => {
    const items = [item('__LOCALID_abc', { remoteId: 'chat-1', updatedAt: 1000 })];
    expect(pickInitialSession(items, 'chat-1')).toBe('__LOCALID_abc');
  });

  it('falls back to the most-recent when the persisted id no longer exists', () => {
    const items = [
      item('thread-a', { remoteId: 'chat-a', updatedAt: 1000 }),
      item('thread-b', { remoteId: 'chat-b', updatedAt: 2000 }),
    ];
    expect(pickInitialSession(items, 'chat-gone')).toBe('thread-b');
  });

  it('falls back to the most-recent when the persisted session is archived', () => {
    const items = [
      item('thread-arc', { remoteId: 'chat-arc', status: 'archived', updatedAt: 9999 }),
      item('thread-live', { remoteId: 'chat-live', updatedAt: 2000 }),
    ];
    expect(pickInitialSession(items, 'chat-arc')).toBe('thread-live');
  });

  it('falls back to the most-recent when preferredRemoteId is null', () => {
    const items = [
      item('thread-a', { remoteId: 'chat-a', updatedAt: 1000 }),
      item('thread-b', { remoteId: 'chat-b', updatedAt: 2000 }),
    ];
    expect(pickInitialSession(items, null)).toBe('thread-b');
  });
});

// ---------------------------------------------------------------------------
// pickInitialSession — pinned state does not affect the result
// ---------------------------------------------------------------------------

describe('pickInitialSession — pinned state does not affect selection', () => {
  it('returns the unpinned newer item over the pinned older item', () => {
    const items = [
      item('pinned-old', { pinned: true, updatedAt: 500 }),
      item('unpinned-new', { pinned: false, updatedAt: 1500 }),
    ];
    expect(pickInitialSession(items)).toBe('unpinned-new');
  });
});
