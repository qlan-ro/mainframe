/**
 * useSessionTabsSync — the preview slot end to end: which activations peek and
 * which pin, and how the slot survives a boot. (The hydration boot-race and the
 * first-send identity handoff live in use-session-tabs-sync.test.tsx, which is
 * at its size limit.)
 *
 * Storage is versioned: v2 writes `{v, ids, preview}`, v1 payloads carry `ids`
 * only and read back as an all-pinned strip — a user upgrading mid-session must
 * not lose their tabs.
 */
import { it, expect, vi, beforeEach, describe } from 'vitest';
import { renderHook } from '@testing-library/react';
import { SESSION_TABS_STORAGE_KEY } from '../tabs-model';
import { useSessionTabsStore } from '../store';
import { useSessionListLoadState } from '@/features/sessions/runtime/list-load-state';

// ---------------------------------------------------------------------------
// Mutable module-scope state the mocked @assistant-ui/react selector reads.
// ---------------------------------------------------------------------------

let itemsValue: Array<{ id: string; status?: string; custom?: unknown; remoteId?: string; title?: string }>;
let isLoadingValue: boolean;
let mainThreadIdValue: string | null;

vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@assistant-ui/react')>('@assistant-ui/react');
  return {
    ...actual,
    useAuiState: (
      sel: (s: {
        threads: {
          threadItems: typeof itemsValue;
          isLoading: boolean;
          mainThreadId: string | null;
        };
      }) => unknown,
    ) => sel({ threads: { threadItems: itemsValue, isLoading: isLoadingValue, mainThreadId: mainThreadIdValue } }),
  };
});

import { useSessionTabsSync } from '../use-session-tabs-sync';

function readPersisted(): unknown {
  const raw = localStorage.getItem(SESSION_TABS_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

/** A settled, real list: what `adapter.list()` returning looks like to the hook. */
function settledList(items: typeof itemsValue): void {
  itemsValue = items;
  isLoadingValue = false;
  useSessionListLoadState.setState({ loaded: true });
}

const SESSION_A = { id: 'chat-a', status: 'regular', custom: {}, title: 'Fix the parser' };
const SESSION_B = { id: 'chat-b', status: 'regular', custom: {}, title: 'Write the docs' };
const SESSION_C = { id: 'chat-c', status: 'regular', custom: {}, title: 'Ship the release' };

beforeEach(() => {
  itemsValue = [];
  isLoadingValue = true;
  mainThreadIdValue = null;
  localStorage.clear();
  useSessionTabsStore.setState({ tabIds: [], previewId: null, hydrated: false });
  useSessionListLoadState.setState({ loaded: false });
});

describe('activation', () => {
  it('opens an activated session as the preview, not as a pinned tab', () => {
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-b';

    renderHook(() => useSessionTabsSync());

    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual([]);
    expect(state.previewId).toBe('chat-b');
  });

  it('replaces the previewed session when the user opens another one', () => {
    settledList([SESSION_A, SESSION_B, SESSION_C]);
    mainThreadIdValue = 'chat-b';
    const { rerender } = renderHook(() => useSessionTabsSync());

    mainThreadIdValue = 'chat-c';
    rerender();

    const state = useSessionTabsStore.getState();
    expect(state.previewId).toBe('chat-c');
    expect(state.tabIds).toEqual([]);
  });

  it('leaves the preview alone when a pinned session is re-activated', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a'], preview: null }));
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-b';
    const { rerender } = renderHook(() => useSessionTabsSync());

    mainThreadIdValue = 'chat-a';
    rerender();

    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual(['chat-a']);
    expect(state.previewId).toBe('chat-b');
  });

  it('pins a just-created draft immediately and keeps the peek beside it', () => {
    // "+" is a deliberate new tab, not a peek at history.
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-b';
    const { rerender } = renderHook(() => useSessionTabsSync());

    itemsValue = [SESSION_A, SESSION_B, { id: '__LOCALID_1', status: 'new' }];
    mainThreadIdValue = '__LOCALID_1';
    rerender();

    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual(['__LOCALID_1']);
    expect(state.previewId).toBe('chat-b');
  });

  it('previews a session re-opened by the local id it kept after its first send', () => {
    // `shouldPinOnOpen` reads the ENTRY's status, not the id shape: a session
    // created this run still answers to `__LOCALID_*`, but once sent it is a
    // regular session and re-opening it peeks like any other.
    settledList([SESSION_A, { id: '__LOCALID_5', status: 'regular', remoteId: 'chat-b', custom: {} }]);
    mainThreadIdValue = 'chat-a';
    const { rerender } = renderHook(() => useSessionTabsSync());

    mainThreadIdValue = '__LOCALID_5';
    rerender();

    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual([]);
    expect(state.previewId).toBe('__LOCALID_5');
  });
});

describe('persistence (v3)', () => {
  it('writes the pinned ids and the preview under a v2 payload', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a'], preview: null }));
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-b';

    renderHook(() => useSessionTabsSync());

    expect(readPersisted()).toEqual({ v: 3, ids: ['chat-a'], preview: 'chat-b', zones: [], zonesFrac: null });
  });

  it('stores the preview as its boot-stable remoteId', () => {
    // The previewed session was created this run, so its runtime id is the
    // local one; only the remoteId means anything next boot.
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a'], preview: null }));
    settledList([SESSION_A, { id: '__LOCALID_5', status: 'regular', remoteId: 'chat-b', custom: {} }]);
    mainThreadIdValue = 'chat-a';
    useSessionTabsStore.setState({ previewId: '__LOCALID_5' });

    renderHook(() => useSessionTabsSync());

    expect(readPersisted()).toEqual({ v: 3, ids: ['chat-a'], preview: 'chat-b', zones: [], zonesFrac: null });
  });

  it('stores a null preview for an unsent draft that means nothing next boot', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a'], preview: 'chat-b' }));
    settledList([SESSION_A, SESSION_B, { id: '__LOCALID_1', status: 'new' }]);
    mainThreadIdValue = '__LOCALID_1';

    renderHook(() => useSessionTabsSync());

    // The draft pinned, so it is the dropped pin — and the restored preview
    // stays as the only survivor of the write.
    expect(readPersisted()).toEqual({ v: 3, ids: ['chat-a'], preview: 'chat-b', zones: [], zonesFrac: null });
  });

  it('clears the stored preview once the user closes it', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a'], preview: 'chat-b' }));
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';
    const { rerender } = renderHook(() => useSessionTabsSync());

    useSessionTabsStore.getState().closeTab('chat-b');
    rerender();

    expect(readPersisted()).toEqual({ v: 3, ids: ['chat-a'], preview: null, zones: [], zonesFrac: null });
  });
});

describe('restore', () => {
  it('restores a v1 payload as an all-pinned strip with an empty preview slot', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 1, ids: ['chat-a', 'chat-b'] }));
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';

    renderHook(() => useSessionTabsSync());

    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual(['chat-a', 'chat-b']);
    expect(state.previewId).toBeNull();
  });

  it('restores the persisted preview into the slot, not into the pinned set', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a'], preview: 'chat-b' }));
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';

    renderHook(() => useSessionTabsSync());

    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual(['chat-a']);
    expect(state.previewId).toBe('chat-b');
  });

  it('maps a persisted preview onto this boot runtime id', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a'], preview: 'chat-b' }));
    settledList([SESSION_A, { id: '__LOCALID_5', status: 'regular', remoteId: 'chat-b', custom: {} }]);
    mainThreadIdValue = 'chat-a';

    renderHook(() => useSessionTabsSync());

    expect(useSessionTabsStore.getState().previewId).toBe('__LOCALID_5');
  });

  it('empties the slot when the persisted preview is gone', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a'], preview: 'chat-deleted' }));
    settledList([SESSION_A]);
    mainThreadIdValue = 'chat-a';

    renderHook(() => useSessionTabsSync());

    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual(['chat-a']);
    expect(state.previewId).toBeNull();
  });

  it('keeps the session opened this boot over the persisted preview', () => {
    // A deep-link peek is on screen before the list settles; restore must not
    // swap it out from under the user.
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a'], preview: 'chat-b' }));
    isLoadingValue = true;
    itemsValue = [{ id: '__LOCALID_1', status: 'new' }];
    mainThreadIdValue = 'chat-c';
    const { rerender } = renderHook(() => useSessionTabsSync());

    settledList([SESSION_A, SESSION_B, SESSION_C]);
    rerender();

    const state = useSessionTabsStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.tabIds).toEqual(['chat-a']);
    expect(state.previewId).toBe('chat-c');
    expect(readPersisted()).toEqual({ v: 3, ids: ['chat-a'], preview: 'chat-c', zones: [], zonesFrac: null });
  });
});
