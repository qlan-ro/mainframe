import { describe, it, expect } from 'vitest';
import type { SessionItem, SessionCustom } from '../chat-to-thread-custom';
import { pickInitialSession } from '../initial-session';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function item(id: string, overrides: Partial<SessionCustom> & { status?: SessionItem['status'] } = {}): SessionItem {
  const { status = 'regular', ...customOverrides } = overrides;
  return {
    id,
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
