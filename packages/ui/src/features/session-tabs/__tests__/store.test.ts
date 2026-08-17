/**
 * session-tabs store — the open set, editor-style: an ordered PINNED list plus
 * ONE preview slot, both held as runtime thread ids. Two invariants carry the
 * feature: an activation is a peek (it replaces the preview) unless it opens
 * elsewhere, and restore must not clobber the tabs the boot already opened —
 * including the preview that is on screen while the persisted one is still
 * being restored. The third slot (the protected draft) lives in
 * store.draft.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionTabsStore } from '../store';

const pinned = () => useSessionTabsStore.getState().tabIds;
const preview = () => useSessionTabsStore.getState().previewId;

beforeEach(() => {
  useSessionTabsStore.setState({ tabIds: [], previewId: null, draftId: null, hydrated: false });
});

describe('ensureTab', () => {
  it('opens an activated session in the preview slot, leaving the pinned set empty', () => {
    useSessionTabsStore.getState().ensureTab('a');

    expect(pinned()).toEqual([]);
    expect(preview()).toBe('a');
  });

  it('replaces the previewed session when another unpinned session is activated', () => {
    // The whole point of the temporary slot: peeking at B does not accumulate A.
    useSessionTabsStore.getState().ensureTab('a');

    useSessionTabsStore.getState().ensureTab('b');

    expect(preview()).toBe('b');
    expect(pinned()).toEqual([]);
  });

  it('appends to the pinned set and leaves the preview alone for the pinned slot', () => {
    // Splitting a session onto a zone is a "keep this open" signal.
    useSessionTabsStore.setState({ tabIds: ['a'], previewId: 'p' });

    useSessionTabsStore.getState().ensureTab('b', 'pinned');

    expect(pinned()).toEqual(['a', 'b']);
    expect(preview()).toBe('p');
  });

  it('leaves the preview untouched when a pinned session is re-activated', () => {
    // The membership seam fires on every active-thread change, including
    // switching back to a pinned tab — that must not evict the peek.
    useSessionTabsStore.setState({ tabIds: ['a', 'b'], previewId: 'p' });
    const before = useSessionTabsStore.getState();

    useSessionTabsStore.getState().ensureTab('a');

    expect(pinned()).toEqual(['a', 'b']);
    expect(preview()).toBe('p');
    expect(useSessionTabsStore.getState()).toBe(before);
  });

  it('is idempotent for the previewed session — no duplicate, no promotion', () => {
    useSessionTabsStore.setState({ tabIds: ['a'], previewId: 'p' });

    useSessionTabsStore.getState().ensureTab('p');

    expect(pinned()).toEqual(['a']);
    expect(preview()).toBe('p');
  });

  it('does not promote the previewed session even when asked for the pinned slot', () => {
    // Already-open wins over the requested slot: membership is decided once,
    // on the activation that opened the tab.
    useSessionTabsStore.setState({ tabIds: [], previewId: '__LOCALID_1' });

    useSessionTabsStore.getState().ensureTab('__LOCALID_1', 'pinned');

    expect(pinned()).toEqual([]);
    expect(preview()).toBe('__LOCALID_1');
  });
});

describe('pinTab', () => {
  it('moves the previewed session into the pinned set and empties the slot', () => {
    useSessionTabsStore.setState({ tabIds: ['a'], previewId: 'p' });

    useSessionTabsStore.getState().pinTab('p');

    expect(pinned()).toEqual(['a', 'p']);
    expect(preview()).toBeNull();
  });

  it('is a no-op for a session that is already pinned', () => {
    useSessionTabsStore.setState({ tabIds: ['a'], previewId: 'p' });
    const before = useSessionTabsStore.getState();

    useSessionTabsStore.getState().pinTab('a');

    expect(pinned()).toEqual(['a']);
    expect(preview()).toBe('p');
    expect(useSessionTabsStore.getState()).toBe(before);
  });

  it('is a no-op for a session that is not open at all', () => {
    useSessionTabsStore.setState({ tabIds: ['a'], previewId: 'p' });

    useSessionTabsStore.getState().pinTab('zzz');

    expect(pinned()).toEqual(['a']);
    expect(preview()).toBe('p');
  });
});

describe('closeTab', () => {
  it('clears only the preview slot when the previewed session is closed', () => {
    useSessionTabsStore.setState({ tabIds: ['a', 'b'], previewId: 'p' });

    useSessionTabsStore.getState().closeTab('p');

    expect(pinned()).toEqual(['a', 'b']);
    expect(preview()).toBeNull();
  });

  it('removes a pinned tab, keeps the rest in order, and keeps the preview', () => {
    useSessionTabsStore.setState({ tabIds: ['a', 'b', 'c'], previewId: 'p' });

    useSessionTabsStore.getState().closeTab('b');

    expect(pinned()).toEqual(['a', 'c']);
    expect(preview()).toBe('p');
  });

  it('is a no-op for an id that is not open', () => {
    useSessionTabsStore.setState({ tabIds: ['a'], previewId: 'p' });

    useSessionTabsStore.getState().closeTab('zzz');

    expect(pinned()).toEqual(['a']);
    expect(preview()).toBe('p');
  });
});

describe('hydrate', () => {
  it('puts the restored pins first and keeps pre-hydration pins after them', () => {
    useSessionTabsStore.setState({ tabIds: ['boot'] });

    useSessionTabsStore.getState().hydrate(['a', 'b'], null);

    expect(pinned()).toEqual(['a', 'b', 'boot']);
    expect(useSessionTabsStore.getState().hydrated).toBe(true);
  });

  it('does not duplicate a pre-hydration pin that is also in the restored set', () => {
    // Boot auto-selects the most-recent session, which is usually persisted too.
    useSessionTabsStore.setState({ tabIds: ['b'] });

    useSessionTabsStore.getState().hydrate(['a', 'b'], null);

    expect(pinned()).toEqual(['a', 'b']);
  });

  it('keeps the live preview and discards the persisted one', () => {
    // The boot's peek is what is on screen; the restored preview is history.
    useSessionTabsStore.setState({ tabIds: [], previewId: 'live' });

    useSessionTabsStore.getState().hydrate(['a'], 'stored');

    expect(preview()).toBe('live');
    expect(pinned()).toEqual(['a']);
  });

  it('restores the persisted preview when the boot opened none', () => {
    useSessionTabsStore.getState().hydrate(['a'], 'stored');

    expect(preview()).toBe('stored');
    expect(pinned()).toEqual(['a']);
  });

  it('drops a restored preview that is also in the restored pins', () => {
    // One session, one tab: the pin wins and the slot stays free.
    useSessionTabsStore.getState().hydrate(['a', 'b'], 'b');

    expect(pinned()).toEqual(['a', 'b']);
    expect(preview()).toBeNull();
  });

  it('marks the store hydrated even with nothing to restore', () => {
    useSessionTabsStore.getState().hydrate([], null);

    expect(pinned()).toEqual([]);
    expect(preview()).toBeNull();
    expect(useSessionTabsStore.getState().hydrated).toBe(true);
  });
});

describe('reconcile', () => {
  it('applies the resolver to the live state', () => {
    useSessionTabsStore.setState({ tabIds: ['a', 'gone', 'b'], previewId: 'stale' });

    useSessionTabsStore.getState().reconcile((s) => ({
      ...s,
      tabIds: s.tabIds.filter((id) => id !== 'gone'),
      previewId: 'fresh',
    }));

    expect(pinned()).toEqual(['a', 'b']);
    expect(preview()).toBe('fresh');
  });

  it('swaps a pinned id in place — the tab keeps its slot', () => {
    // The store half of the local→remote identity swap: the resolver maps one
    // id to another without removing and re-appending it.
    useSessionTabsStore.setState({ tabIds: ['a', 'local', 'b'] });

    useSessionTabsStore.getState().reconcile((s) => ({
      ...s,
      tabIds: s.tabIds.map((id) => (id === 'local' ? 'remote' : id)),
    }));

    expect(pinned()).toEqual(['a', 'remote', 'b']);
  });

  it('leaves the state object untouched when the resolver returns what it got', () => {
    // Identity matters, not just equality: the seam reconciles on every
    // thread-list change, and a fresh object each time would re-render the
    // whole strip while a chat streams — even though the resolver allocates a
    // new array on every call.
    useSessionTabsStore.setState({ tabIds: ['a', 'b'], previewId: 'p' });
    const before = useSessionTabsStore.getState();

    useSessionTabsStore.getState().reconcile((s) => ({ ...s, tabIds: [...s.tabIds] }));

    expect(useSessionTabsStore.getState()).toBe(before);
  });

  it('writes new state when only the preview changed', () => {
    useSessionTabsStore.setState({ tabIds: ['a'], previewId: 'p' });

    useSessionTabsStore.getState().reconcile((s) => ({ ...s, previewId: null }));

    expect(pinned()).toEqual(['a']);
    expect(preview()).toBeNull();
  });

  it('empties the strip when the resolver returns nothing', () => {
    useSessionTabsStore.setState({ tabIds: ['a'], previewId: 'p' });

    useSessionTabsStore.getState().reconcile(() => ({ tabIds: [], previewId: null, draftId: null }));

    expect(pinned()).toEqual([]);
    expect(preview()).toBeNull();
  });

  it('reads the current state, not a snapshot captured before the call', () => {
    useSessionTabsStore.setState({ tabIds: ['a'] });

    useSessionTabsStore.getState().ensureTab('b');
    useSessionTabsStore.getState().reconcile((s) => s);

    expect(pinned()).toEqual(['a']);
    expect(preview()).toBe('b');
  });
});
