/**
 * thread-list-projection — behavior tests for the canonical aui thread-entry →
 * SessionItem seam (threadItemsToSessionItems / threadListStateToSessionItems).
 *
 * These cover the mapping behaviors that previously lived in use-session-items
 * (field mapping, status mapping, undefined title) PLUS the seam-specific ones:
 * the array projection (store-scope shape) and the Record/threadIds projection
 * (runtime shape) — including threadIds ordering and skipping ids without a
 * materialized entry. The aui `custom` slot (typed Record<string, unknown>) is
 * narrowed to SessionCustom in exactly one place; the tests assert the narrowed
 * value is the same object reference that came in.
 */
import { describe, it, expect } from 'vitest';
import type { SessionCustom, ThreadListEntry, ThreadListRecordState } from '../chat-to-thread-custom';
import { threadItemsToSessionItems, threadListStateToSessionItems } from '../chat-to-thread-custom';

// ---------------------------------------------------------------------------
// Shared fixtures
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

// aui hands us `custom` typed Record<string, unknown>; mirror that at the test
// boundary so fixtures match the real entry shape while preserving the reference.
function asCustomSlot(custom: SessionCustom): Record<string, unknown> {
  return custom as unknown as Record<string, unknown>;
}

function makeEntry(id: string, overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return {
    id,
    remoteId: id,
    title: `Session ${id}`,
    status: 'regular',
    custom: asCustomSlot(makeCustom()),
    ...overrides,
  };
}

function makeState(entries: ThreadListEntry[]): ThreadListRecordState {
  return {
    threadIds: entries.map((e) => e.id),
    threadItems: Object.fromEntries(entries.map((e) => [e.id, e])),
  };
}

// ---------------------------------------------------------------------------
// 1. Full field mapping: id, remoteId, title, status:'regular', custom by ref
// ---------------------------------------------------------------------------

describe('threadListStateToSessionItems — maps an entry to a SessionItem with same fields', () => {
  it('maps id, remoteId, title, status "regular", and custom (by reference) from one entry', () => {
    const custom = makeCustom();
    const state = makeState([makeEntry('chat-1', { remoteId: 'chat-1', title: 'T', custom: asCustomSlot(custom) })]);

    const result = threadListStateToSessionItems(state);

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

describe('threadListStateToSessionItems — status mapping', () => {
  it('maps status "archived" to "archived"', () => {
    const result = threadListStateToSessionItems(makeState([makeEntry('c1', { status: 'archived' })]));
    expect(result[0]?.status).toBe('archived');
  });

  it('maps status "active" to "regular"', () => {
    const result = threadListStateToSessionItems(makeState([makeEntry('c2', { status: 'active' })]));
    expect(result[0]?.status).toBe('regular');
  });

  it('maps status "regular" to "regular"', () => {
    const result = threadListStateToSessionItems(makeState([makeEntry('c3', { status: 'regular' })]));
    expect(result[0]?.status).toBe('regular');
  });

  it('maps an unknown status string to "regular"', () => {
    const result = threadListStateToSessionItems(makeState([makeEntry('c4', { status: 'some-other-status' })]));
    expect(result[0]?.status).toBe('regular');
  });
});

// ---------------------------------------------------------------------------
// 3. title undefined maps to undefined
// ---------------------------------------------------------------------------

describe('threadListStateToSessionItems — undefined title maps to undefined', () => {
  it('results in title undefined when the entry has no title', () => {
    const result = threadListStateToSessionItems(makeState([makeEntry('c5', { title: undefined })]));
    expect(result[0]?.title).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Order follows threadIds, not threadItems insertion/key order
// ---------------------------------------------------------------------------

describe('threadListStateToSessionItems — preserves threadIds order', () => {
  it('emits items in threadIds order even when threadItems is keyed differently', () => {
    const a = makeEntry('a');
    const b = makeEntry('b');
    const c = makeEntry('c');
    // threadIds order is [c, a, b]; threadItems record key order is [a, b, c].
    const state: ThreadListRecordState = {
      threadIds: ['c', 'a', 'b'],
      threadItems: { a, b, c },
    };

    const result = threadListStateToSessionItems(state);

    expect(result.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// 5. Skips ids that have no materialized entry in threadItems
// ---------------------------------------------------------------------------

describe('threadListStateToSessionItems — skips ids absent from threadItems', () => {
  it('drops a threadId whose entry is missing from the record', () => {
    const a = makeEntry('a');
    const state: ThreadListRecordState = {
      threadIds: ['a', 'ghost'],
      threadItems: { a },
    };

    const result = threadListStateToSessionItems(state);

    expect(result.map((i) => i.id)).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// 6. threadItemsToSessionItems — array (store-scope) projection
// ---------------------------------------------------------------------------

describe('threadItemsToSessionItems — maps an ordered array of entries', () => {
  it('maps every entry, preserving array order, status, and custom by reference', () => {
    const customB = makeCustom();
    const entries: ThreadListEntry[] = [
      makeEntry('a'),
      makeEntry('b', { status: 'archived', custom: asCustomSlot(customB) }),
    ];

    const result = threadItemsToSessionItems(entries);

    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
    expect(result[0]?.status).toBe('regular');
    expect(result[1]?.status).toBe('archived');
    expect(result[1]?.custom).toBe(customB);
  });

  it('maps an empty array to an empty list', () => {
    expect(threadItemsToSessionItems([])).toEqual([]);
  });

  it('maps an entry with undefined title to undefined title', () => {
    const result = threadItemsToSessionItems([makeEntry('c', { title: undefined })]);
    expect(result[0]?.title).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Drop the transient new/draft thread (no `custom`) — it is not a session row.
//    The native thread list always contains a __LOCALID_* entry with status
//    'new' and custom undefined (no daemon chat yet). Mapping it would produce a
//    SessionItem whose custom is undefined, crashing downstream `.custom.X`
//    selectors (e.g. `t.custom.tags`). The projection must drop it at the source.
// ---------------------------------------------------------------------------

describe('projection drops the custom-less new/draft thread', () => {
  it('threadItemsToSessionItems returns only the real entry from a mixed array', () => {
    const draft = makeEntry('__LOCALID_x', { status: 'new', custom: undefined });
    const real = makeEntry('chat-real');

    const result = threadItemsToSessionItems([draft, real]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('chat-real');
  });

  it('threadListStateToSessionItems returns only the real entry from a mixed state', () => {
    const draft = makeEntry('__LOCALID_x', { status: 'new', custom: undefined });
    const real = makeEntry('chat-real');

    const result = threadListStateToSessionItems(makeState([draft, real]));

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('chat-real');
  });
});
