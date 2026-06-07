/**
 * use-session-items — behavior tests (TDD red phase).
 *
 * Pure function threadsToSessionItems(threads). Behaviors:
 *  1. Maps a native thread to a SessionItem with the same id, remoteId,
 *     title, status:'regular', and custom passed through by reference.
 *  2. A thread with status:'archived' maps to status:'archived';
 *     any other status maps to 'regular'.
 *  3. A thread with title undefined maps to title undefined.
 */
import { describe, it, expect } from 'vitest';
import type { SessionCustom } from '../../view-model/chat-to-thread-custom';

// threadsToSessionItems does not exist yet — importing it will fail (red phase).
const { threadsToSessionItems } = await import('../use-session-items');

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

function makeCustom(): SessionCustom {
  return {
    projectId: 'proj-1',
    adapterId: 'claude',
    tags: ['bug'],
    pinned: false,
    status: 'active',
    displayStatus: 'idle',
    hasPending: false,
    detectedPrs: [],
    worktreeMissing: false,
    updatedAt: 1749284160000,
  };
}

// ---------------------------------------------------------------------------
// 1. Full mapping: id, remoteId, title, status:'regular', custom by reference
// ---------------------------------------------------------------------------

describe('threadsToSessionItems — maps native thread to SessionItem with same fields', () => {
  it('maps id, remoteId, title, status "regular", and custom through from a single thread', () => {
    const custom = makeCustom();
    const threads = [
      {
        id: 'chat-1',
        remoteId: 'chat-1',
        title: 'T',
        status: 'regular',
        custom,
      },
    ];

    const result = threadsToSessionItems(threads);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('chat-1');
    expect(result[0]?.remoteId).toBe('chat-1');
    expect(result[0]?.title).toBe('T');
    expect(result[0]?.status).toBe('regular');
    expect(result[0]?.custom).toBe(custom);
  });
});

// ---------------------------------------------------------------------------
// 2. status: 'archived' → 'archived'; any other → 'regular'
// ---------------------------------------------------------------------------

describe('threadsToSessionItems — status mapping', () => {
  it('maps status "archived" to "archived"', () => {
    const threads = [{ id: 'c1', remoteId: 'c1', title: 'A', status: 'archived', custom: makeCustom() }];
    const result = threadsToSessionItems(threads);
    expect(result[0]?.status).toBe('archived');
  });

  it('maps status "active" to "regular"', () => {
    const threads = [{ id: 'c2', remoteId: 'c2', title: 'B', status: 'active', custom: makeCustom() }];
    const result = threadsToSessionItems(threads);
    expect(result[0]?.status).toBe('regular');
  });

  it('maps an unknown status string to "regular"', () => {
    const threads = [{ id: 'c3', remoteId: 'c3', title: 'C', status: 'some-other-status', custom: makeCustom() }];
    const result = threadsToSessionItems(threads);
    expect(result[0]?.status).toBe('regular');
  });
});

// ---------------------------------------------------------------------------
// 3. title undefined maps to undefined
// ---------------------------------------------------------------------------

describe('threadsToSessionItems — undefined title maps to undefined', () => {
  it('results in title undefined when the thread has no title', () => {
    const threads = [{ id: 'c4', remoteId: 'c4', title: undefined, status: 'regular', custom: makeCustom() }];
    const result = threadsToSessionItems(threads);
    expect(result[0]?.title).toBeUndefined();
  });
});
