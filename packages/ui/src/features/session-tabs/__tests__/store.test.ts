/**
 * session-tabs store — the open set of session tabs as runtime thread ids in
 * display order. Restore ordering matters: tabs opened BEFORE hydration (the
 * boot draft, the auto-selected most-recent session) must survive the restore
 * rather than be clobbered by it, and must not double up.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionTabsStore } from '../store';

const read = () => useSessionTabsStore.getState().tabIds;

beforeEach(() => {
  useSessionTabsStore.setState({ tabIds: [], hydrated: false });
});

describe('ensureTab', () => {
  it('appends new tabs in call order', () => {
    useSessionTabsStore.getState().ensureTab('a');
    useSessionTabsStore.getState().ensureTab('b');

    expect(read()).toEqual(['a', 'b']);
  });

  it('is idempotent — re-ensuring an open tab neither duplicates nor reorders it', () => {
    // The membership seam fires on every active-thread change, including
    // switching back to a tab that is already open.
    useSessionTabsStore.setState({ tabIds: ['a', 'b'] });

    useSessionTabsStore.getState().ensureTab('a');

    expect(read()).toEqual(['a', 'b']);
  });
});

describe('closeTab', () => {
  it('removes the tab and leaves the rest in order', () => {
    useSessionTabsStore.setState({ tabIds: ['a', 'b', 'c'] });

    useSessionTabsStore.getState().closeTab('b');

    expect(read()).toEqual(['a', 'c']);
  });

  it('is a no-op for an id that is not open', () => {
    useSessionTabsStore.setState({ tabIds: ['a'] });

    useSessionTabsStore.getState().closeTab('zzz');

    expect(read()).toEqual(['a']);
  });
});

describe('hydrate', () => {
  it('puts the restored ids first and keeps pre-hydration tabs after them', () => {
    useSessionTabsStore.setState({ tabIds: ['boot'] });

    useSessionTabsStore.getState().hydrate(['a', 'b']);

    expect(read()).toEqual(['a', 'b', 'boot']);
    expect(useSessionTabsStore.getState().hydrated).toBe(true);
  });

  it('does not duplicate a pre-hydration tab that is also in the restored set', () => {
    // Boot auto-selects the most-recent session, which is usually persisted too.
    useSessionTabsStore.setState({ tabIds: ['b'] });

    useSessionTabsStore.getState().hydrate(['a', 'b']);

    expect(read()).toEqual(['a', 'b']);
  });

  it('marks the store hydrated even with nothing to restore', () => {
    useSessionTabsStore.getState().hydrate([]);

    expect(read()).toEqual([]);
    expect(useSessionTabsStore.getState().hydrated).toBe(true);
  });
});

describe('reconcile', () => {
  it('applies the resolver to the live ids', () => {
    useSessionTabsStore.setState({ tabIds: ['a', 'gone', 'b'] });

    useSessionTabsStore.getState().reconcile((ids) => ids.filter((id) => id !== 'gone'));

    expect(read()).toEqual(['a', 'b']);
  });

  it('swaps an id in place — the tab keeps its slot', () => {
    // This is the store half of the local→remote identity swap: the resolver
    // maps one id to another without removing and re-appending it.
    useSessionTabsStore.setState({ tabIds: ['a', 'local', 'b'] });

    useSessionTabsStore.getState().reconcile((ids) => ids.map((id) => (id === 'local' ? 'remote' : id)));

    expect(read()).toEqual(['a', 'remote', 'b']);
  });

  it('leaves the state object untouched when the resolver returns an equal list', () => {
    // Identity matters, not just equality: the seam reconciles on every
    // thread-list change, and a fresh object each time would re-render the
    // whole strip while a chat streams — even though the resolver allocates a
    // new array on every call.
    useSessionTabsStore.setState({ tabIds: ['a', 'b'] });
    const before = useSessionTabsStore.getState();

    useSessionTabsStore.getState().reconcile((ids) => [...ids]);

    expect(useSessionTabsStore.getState()).toBe(before);
  });

  it('empties the strip when the resolver returns nothing', () => {
    useSessionTabsStore.setState({ tabIds: ['a'] });

    useSessionTabsStore.getState().reconcile(() => []);

    expect(read()).toEqual([]);
  });

  it('reads the current ids, not a snapshot captured before the call', () => {
    useSessionTabsStore.setState({ tabIds: ['a'] });

    useSessionTabsStore.getState().ensureTab('b');
    useSessionTabsStore.getState().reconcile((ids) => ids);

    expect(read()).toEqual(['a', 'b']);
  });
});
