/**
 * tabs-model — the pure translation layer between the persisted tab set and
 * this boot's runtime thread ids.
 *
 * The load-bearing asymmetry: a thread created this app-run keeps its
 * `__LOCALID_*` id for life while the remoteId is stamped onto the SAME entry,
 * so runtime ids are not boot-stable. Storage therefore holds `remoteId ?? id`,
 * and restore matches a persisted id against EITHER field.
 */
import { describe, expect, it } from 'vitest';
import type { ThreadListEntry } from '@/features/sessions/view-model/chat-to-thread-custom';
import { canRestoreTabs, nextActiveAfterClose, persistTabIds, restoreTabIds, validTabIds } from '../tabs-model';

/** A real session row: a regular thread-list entry, optionally remoteId-stamped. */
function entry(id: string, over: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return { id, status: 'regular', ...over };
}

describe('restoreTabIds', () => {
  it('maps persisted remoteIds onto the current runtime ids', () => {
    const items = [entry('__LOCALID_1', { remoteId: 'chat-a' }), entry('chat-b')];

    expect(restoreTabIds(['chat-a', 'chat-b'], items)).toEqual(['__LOCALID_1', 'chat-b']);
  });

  it('drops archived entries', () => {
    const items = [entry('chat-a'), entry('chat-b', { status: 'archived' })];

    expect(restoreTabIds(['chat-a', 'chat-b'], items)).toEqual(['chat-a']);
  });

  it('drops ids no longer in the thread list', () => {
    const items = [entry('chat-a')];

    expect(restoreTabIds(['chat-a', 'chat-deleted'], items)).toEqual(['chat-a']);
  });

  it('dedupes when two persisted ids resolve to the same entry', () => {
    // A stale payload can hold both the runtime id and the remoteId of one thread.
    const items = [entry('__LOCALID_1', { remoteId: 'chat-a' })];

    expect(restoreTabIds(['__LOCALID_1', 'chat-a'], items)).toEqual(['__LOCALID_1']);
  });

  it('returns nothing when the thread list is empty', () => {
    expect(restoreTabIds(['chat-a'], [])).toEqual([]);
  });
});

describe('persistTabIds', () => {
  it('stores the remoteId for a sent local thread', () => {
    const items = [entry('__LOCALID_1', { remoteId: 'chat-a' })];

    expect(persistTabIds(['__LOCALID_1'], items)).toEqual(['chat-a']);
  });

  it.each([
    { name: 'has no thread-list entry at all', items: [] as ThreadListEntry[] },
    { name: 'has an entry but no remoteId (never sent)', items: [entry('__LOCALID_1')] },
  ])('drops an unsent __LOCALID_ tab that $name', ({ items }) => {
    expect(persistTabIds(['__LOCALID_1'], items)).toEqual([]);
  });

  it('stores a plain id as itself when no entry matches', () => {
    expect(persistTabIds(['chat-a'], [])).toEqual(['chat-a']);
  });

  it('keeps display order and drops only the unsent draft', () => {
    const items = [entry('chat-a'), entry('__LOCALID_2', { remoteId: 'chat-c' })];

    expect(persistTabIds(['chat-a', '__LOCALID_1', '__LOCALID_2'], items)).toEqual(['chat-a', 'chat-c']);
  });
});

describe('nextActiveAfterClose', () => {
  const TABS = ['a', 'b', 'c'];

  it.each([
    { name: 'an inactive tab keeps the current active', tabs: TABS, closed: 'a', active: 'c', expected: 'c' },
    { name: 'the active middle tab activates its right neighbor', tabs: TABS, closed: 'b', active: 'b', expected: 'c' },
    { name: 'the active last tab falls back to the left', tabs: TABS, closed: 'c', active: 'c', expected: 'b' },
    { name: 'the active first tab activates its right neighbor', tabs: TABS, closed: 'a', active: 'a', expected: 'b' },
    { name: 'the only tab leaves nothing active', tabs: ['a'], closed: 'a', active: 'a', expected: null },
  ])('closing $name', ({ tabs, closed, active, expected }) => {
    expect(nextActiveAfterClose(tabs, closed, active)).toBe(expected);
  });
});

describe('validTabIds', () => {
  it('keeps regular entries', () => {
    const items = [entry('chat-a'), entry('chat-b')];

    expect([...validTabIds(items, 'chat-a')].sort()).toEqual(['chat-a', 'chat-b']);
  });

  it('keeps the ACTIVE draft even though it is not a regular entry', () => {
    // The unsent draft has status 'new' and no custom, so it is not a list row —
    // but it IS the focused tab while the user types into it.
    const items = [entry('chat-a'), entry('__LOCALID_1', { status: 'new' })];

    expect([...validTabIds(items, '__LOCALID_1')].sort()).toEqual(['__LOCALID_1', 'chat-a']);
  });

  it('excludes an INACTIVE draft — the boot-draft cleanup rule', () => {
    // aui reuses one `__LOCALID_*` slot, so "+" reaches the same draft again;
    // a lingering "New Session" tab would survive every boot's auto-select redirect.
    const items = [entry('chat-a'), entry('__LOCALID_1', { status: 'new' })];

    expect([...validTabIds(items, 'chat-a')]).toEqual(['chat-a']);
  });

  it('excludes archived entries', () => {
    const items = [entry('chat-a'), entry('chat-b', { status: 'archived' })];

    expect([...validTabIds(items, null)]).toEqual(['chat-a']);
  });
});

describe('canRestoreTabs', () => {
  it('returns false while the list is still loading, even with real sessions present', () => {
    expect(canRestoreTabs([entry('chat-a', { custom: {} })], true, true)).toBe(false);
  });

  it('returns false for a settled list holding only the synthetic draft', () => {
    const items: ThreadListEntry[] = [{ id: '__LOCALID_1', status: 'new' }];

    expect(canRestoreTabs(items, false, true)).toBe(false);
  });

  it('returns false for a settled empty list', () => {
    expect(canRestoreTabs([], false, true)).toBe(false);
  });

  it('returns true for a settled list with a real session', () => {
    expect(canRestoreTabs([entry('chat-a', { custom: {} })], false, true)).toBe(true);
  });

  it('returns false for a remoteId-stamped draft with no listed session (first send after a failed load)', () => {
    const items: ThreadListEntry[] = [{ id: '__LOCALID_1', status: 'regular', remoteId: 'chat-a' }];

    expect(canRestoreTabs(items, false, false)).toBe(false);
  });

  it('returns false for a custom-carrying entry when no list ever loaded (deep-link fetch injection)', () => {
    expect(canRestoreTabs([entry('chat-a', { custom: {} })], false, false)).toBe(false);
  });

  it('returns false for a remoteId-stamped draft even once the list has settled (remoteId alone never proves a session)', () => {
    // Pins the narrowing independently of the listLoaded gate: a fresh install's empty
    // list() succeeds (listLoaded=true), the user sends, and the draft is remoteId-stamped
    // before its custom-carrying entry lands on the next reload.
    const items: ThreadListEntry[] = [{ id: '__LOCALID_1', status: 'regular', remoteId: 'chat-a' }];

    expect(canRestoreTabs(items, false, true)).toBe(false);
  });

  it('returns true for a settled list of only archived entries', () => {
    const items = [entry('chat-a', { status: 'archived', custom: {} })];

    expect(canRestoreTabs(items, false, true)).toBe(true);
  });
});
