/**
 * thread-list-projection — behavior tests for the canonical aui thread-entry →
 * SessionItem seam over the store-scope `threadItems` array: the full projection
 * plus its regular-only and archived-only variants.
 *
 * These cover the mapping behaviors that previously lived in use-session-items
 * (field mapping, status mapping, undefined title) PLUS the seam-specific ones:
 * order preservation and dropping the custom-less new/draft thread. The aui
 * `custom` slot (typed Record<string, unknown>) is narrowed to SessionCustom in
 * exactly one place; the tests assert the narrowed value is the same object
 * reference that came in.
 */
import { describe, it, expect } from 'vitest';
import type { SessionCustom, ThreadListEntry } from '../chat-to-thread-custom';
import {
  threadItemsToSessionItems,
  regularThreadItemsToSessionItems,
  archivedThreadItemsToSessionItems,
} from '../chat-to-thread-custom';

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
    transcriptMissing: false,
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

// ---------------------------------------------------------------------------
// 1. Full field mapping: id, remoteId, title, status:'regular', custom by ref
// ---------------------------------------------------------------------------

describe('threadItemsToSessionItems — maps an entry to a SessionItem with same fields', () => {
  it('maps id, remoteId, title, status "regular", and custom (by reference) from one entry', () => {
    const custom = makeCustom();
    const entry = makeEntry('chat-1', { remoteId: 'chat-1', title: 'T', custom: asCustomSlot(custom) });

    const result = threadItemsToSessionItems([entry]);

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

describe('threadItemsToSessionItems — status mapping', () => {
  it('maps status "archived" to "archived"', () => {
    const result = threadItemsToSessionItems([makeEntry('c1', { status: 'archived' })]);
    expect(result[0]?.status).toBe('archived');
  });

  it('maps status "active" to "regular"', () => {
    const result = threadItemsToSessionItems([makeEntry('c2', { status: 'active' })]);
    expect(result[0]?.status).toBe('regular');
  });

  it('maps status "regular" to "regular"', () => {
    const result = threadItemsToSessionItems([makeEntry('c3', { status: 'regular' })]);
    expect(result[0]?.status).toBe('regular');
  });

  it('maps an unknown status string to "regular"', () => {
    const result = threadItemsToSessionItems([makeEntry('c4', { status: 'some-other-status' })]);
    expect(result[0]?.status).toBe('regular');
  });
});

// ---------------------------------------------------------------------------
// 3. title undefined maps to undefined
// ---------------------------------------------------------------------------

describe('threadItemsToSessionItems — undefined title maps to undefined', () => {
  it('results in title undefined when the entry has no title', () => {
    const result = threadItemsToSessionItems([makeEntry('c5', { title: undefined })]);
    expect(result[0]?.title).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Emission order follows the input array order
// ---------------------------------------------------------------------------

describe('threadItemsToSessionItems — preserves the input array order', () => {
  it('emits items in the order aui listed them, not sorted by id', () => {
    const a = makeEntry('a');
    const b = makeEntry('b');
    const c = makeEntry('c');

    const result = threadItemsToSessionItems([c, a, b]);

    expect(result.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// 5. threadItemsToSessionItems — multi-entry array (store-scope) projection
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
// 6. Drop the transient new/draft thread (no `custom`) — it is not a session row.
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

  it('drops the draft entry wherever it sits in the array, not only when it leads', () => {
    const draft = makeEntry('__LOCALID_x', { status: 'new', custom: undefined });
    const real = makeEntry('chat-real');

    const result = threadItemsToSessionItems([real, draft]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('chat-real');
  });
});

// ---------------------------------------------------------------------------
// 7. regularThreadItemsToSessionItems — excludes archived entries (the
//    archived-leak fix). The store-scope threadItems array carries BOTH regular
//    and archived threads; this projection is the sidebar/visible-list source
//    and must drop archived ones, unlike threadItemsToSessionItems which keeps
//    the full set for callers that need archived visibility.
// ---------------------------------------------------------------------------

describe('regularThreadItemsToSessionItems — excludes archived entries', () => {
  it('returns only the regular entries from a mix of regular and archived', () => {
    const regular = makeEntry('chat-regular');
    const archived = makeEntry('chat-archived', { status: 'archived' });

    const result = regularThreadItemsToSessionItems([regular, archived]);

    expect(result.map((i) => i.id)).toEqual(['chat-regular']);
    expect(result.every((i) => i.status === 'regular')).toBe(true);
  });

  it('drops the custom-less new/draft entry same as threadItemsToSessionItems', () => {
    const draft = makeEntry('__LOCALID_x', { status: 'new', custom: undefined });
    const real = makeEntry('chat-real');

    const result = regularThreadItemsToSessionItems([draft, real]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('chat-real');
  });

  it('returns an all-regular array unchanged in order', () => {
    const a = makeEntry('a');
    const b = makeEntry('b');
    const c = makeEntry('c');

    const result = regularThreadItemsToSessionItems([a, b, c]);

    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('maps an empty array to an empty list', () => {
    expect(regularThreadItemsToSessionItems([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. archivedThreadItemsToSessionItems — the array-projection complement of
//    regularThreadItemsToSessionItems: keeps only archived entries. It sources
//    the ArchivedSessionsDialog, which is the only surface that shows them.
// ---------------------------------------------------------------------------

describe('archivedThreadItemsToSessionItems — keeps only archived entries', () => {
  it('returns only the archived entries from a mix of regular and archived', () => {
    const regular = makeEntry('chat-regular');
    const archived = makeEntry('chat-archived', { status: 'archived' });

    const result = archivedThreadItemsToSessionItems([regular, archived]);

    expect(result.map((i) => i.id)).toEqual(['chat-archived']);
    expect(result.every((i) => i.status === 'archived')).toBe(true);
  });

  it('drops the custom-less draft entry even when its status is archived', () => {
    const draft = makeEntry('__LOCALID_x', { status: 'archived', custom: undefined });
    const archived = makeEntry('chat-archived', { status: 'archived' });

    const result = archivedThreadItemsToSessionItems([draft, archived]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('chat-archived');
  });

  it('maps id, remoteId, title, and custom through unchanged, and sets status "archived"', () => {
    const custom = makeCustom();
    const entry = makeEntry('chat-1', {
      remoteId: 'remote-1',
      title: 'Archived session',
      status: 'archived',
      custom: asCustomSlot(custom),
    });

    const result = archivedThreadItemsToSessionItems([entry]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('chat-1');
    expect(result[0]?.remoteId).toBe('remote-1');
    expect(result[0]?.title).toBe('Archived session');
    expect(result[0]?.status).toBe('archived');
    expect(result[0]?.custom).toBe(custom);
  });

  it('preserves the input array order', () => {
    const a = makeEntry('a', { status: 'archived' });
    const b = makeEntry('b', { status: 'archived' });
    const c = makeEntry('c', { status: 'archived' });

    const result = archivedThreadItemsToSessionItems([c, a, b]);

    expect(result.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('returns an empty array for an empty input', () => {
    expect(archivedThreadItemsToSessionItems([])).toEqual([]);
  });
});
