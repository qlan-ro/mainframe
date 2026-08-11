/**
 * useSessionTabsSync — the split half of the persisted strip (`mf:session-tabs`
 * v3). The zone pair is stored beside the tab ids, in the same boot-stable id
 * space, and restoring it is deliberately a TWO-STEP dance: focus is switched to
 * the left zone first and the split only opens once focus has landed there.
 * Opening it while the boot draft was still the focused chat made the reconciler
 * read a draft-main and close the split straight back.
 *
 * (The preview slot and the v1/v2 payloads live in
 * use-session-tabs-sync.preview.test.tsx.)
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionListLoadState } from '@/features/sessions/runtime/list-load-state';
import { useZonesStore } from '@/features/chat/zones/zones-store';
import { SESSION_TABS_STORAGE_KEY } from '../tabs-model';
import { useSessionTabsStore } from '../store';

let itemsValue: Array<{ id: string; status?: string; custom?: unknown; remoteId?: string; title?: string }>;
let isLoadingValue: boolean;
let mainThreadIdValue: string | null;
const switchToThread = vi.fn();

vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@assistant-ui/react')>('@assistant-ui/react');
  // ONE stable client across renders: `aui` is a dependency of the hydration
  // effect, so a fresh object per render would re-run the restore.
  const auiClient = { threads: { switchToThread: (id: string) => switchToThread(id) } };
  return {
    ...actual,
    useAui: () => auiClient,
    useAuiState: (
      sel: (s: {
        threads: { threadItems: typeof itemsValue; isLoading: boolean; mainThreadId: string | null };
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
/** A session created THIS run: it answers to a local id but has a remote one. */
const SESSION_LOCAL_B = { id: '__LOCALID_5', status: 'regular', custom: {}, remoteId: 'chat-b', title: 'Fresh' };

const zones = () => useZonesStore.getState().zones;

beforeEach(() => {
  itemsValue = [];
  isLoadingValue = true;
  mainThreadIdValue = null;
  switchToThread.mockReset();
  localStorage.clear();
  useSessionTabsStore.setState({ tabIds: [], previewId: null, hydrated: false });
  useSessionListLoadState.setState({ loaded: false });
  useZonesStore.setState({ zones: null, focusedIndex: 0 });
});

describe('writing the open split', () => {
  it('stores the pair beside the tab ids', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a', 'chat-b'], preview: null }));
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });

    renderHook(() => useSessionTabsSync());

    expect(readPersisted()).toEqual({ v: 3, ids: ['chat-a', 'chat-b'], preview: null, zones: ['chat-a', 'chat-b'] });
  });

  it('stores a zone as its boot-stable remoteId, exactly like a tab', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a'], preview: null }));
    settledList([SESSION_A, SESSION_LOCAL_B]);
    mainThreadIdValue = 'chat-a';
    useZonesStore.setState({ zones: ['chat-a', '__LOCALID_5'], focusedIndex: 0 });

    renderHook(() => useSessionTabsSync());

    // `ids` gains chat-b too: zones ⊆ pinned tabs, so the membership effect
    // pinned the tab-less zone member — both persist remote-keyed.
    expect(readPersisted()).toEqual({ v: 3, ids: ['chat-a', 'chat-b'], preview: null, zones: ['chat-a', 'chat-b'] });
  });

  it('empties the stored pair when the user closes the split', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a', 'chat-b'], preview: null }));
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    const { rerender } = renderHook(() => useSessionTabsSync());

    act(() => {
      useZonesStore.getState().closeSplit();
    });
    rerender();

    expect(readPersisted()).toEqual({ v: 3, ids: ['chat-a', 'chat-b'], preview: null, zones: [] });
  });
});

describe('a preview tab entering the split', () => {
  it('is promoted to pinned — a split member is never temporary', () => {
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';
    useSessionTabsStore.setState({ tabIds: ['chat-a'], previewId: 'chat-b', hydrated: true });
    const { rerender } = renderHook(() => useSessionTabsSync());

    act(() => {
      useZonesStore.getState().openSplit('chat-a', 'chat-b');
    });
    rerender();

    expect(useSessionTabsStore.getState().previewId).toBeNull();
    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a', 'chat-b']);
  });

  it('stays a preview when it is not a zone member', () => {
    settledList([SESSION_A, SESSION_B, { id: 'chat-c', status: 'regular', custom: {}, title: 'Third' }]);
    mainThreadIdValue = 'chat-a';
    useSessionTabsStore.setState({ tabIds: ['chat-a', 'chat-b'], previewId: 'chat-c', hydrated: true });
    const { rerender } = renderHook(() => useSessionTabsSync());

    act(() => {
      useZonesStore.getState().openSplit('chat-a', 'chat-b');
    });
    rerender();

    expect(useSessionTabsStore.getState().previewId).toBe('chat-c');
  });
});

describe('restoring the split across a boot', () => {
  const V3_PAIR = JSON.stringify({ v: 3, ids: ['chat-a', 'chat-b'], preview: null, zones: ['chat-a', 'chat-b'] });

  it('parks the pair and only switches focus to the left zone first', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, V3_PAIR);
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = '__LOCALID_boot';

    renderHook(() => useSessionTabsSync());

    expect(switchToThread).toHaveBeenCalledTimes(1);
    expect(switchToThread).toHaveBeenCalledWith('chat-a');
    // Opening here would hand the reconciler a draft main and close it again.
    expect(zones()).toBeNull();
  });

  it('opens inline when focus is ALREADY the left zone — a deep-link boot has no focus change to wait for', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, V3_PAIR);
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';

    renderHook(() => useSessionTabsSync());

    expect(switchToThread).not.toHaveBeenCalled();
    expect(zones()).toEqual(['chat-a', 'chat-b']);
  });

  it('opens the split once focus has landed on the left zone', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, V3_PAIR);
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = '__LOCALID_boot';
    const { rerender } = renderHook(() => useSessionTabsSync());

    mainThreadIdValue = 'chat-a';
    rerender();

    expect(zones()).toEqual(['chat-a', 'chat-b']);
    expect(useZonesStore.getState().focusedIndex).toBe(0);
  });

  it('opens the split only once, not on every later focus change', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, V3_PAIR);
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = '__LOCALID_boot';
    const { rerender } = renderHook(() => useSessionTabsSync());

    mainThreadIdValue = 'chat-a';
    rerender();
    act(() => {
      useZonesStore.getState().closeSplit();
    });
    mainThreadIdValue = 'chat-b';
    rerender();
    mainThreadIdValue = 'chat-a';
    rerender();

    expect(zones()).toBeNull();
  });

  it('restores no split when one of the two zones is gone', () => {
    localStorage.setItem(
      SESSION_TABS_STORAGE_KEY,
      JSON.stringify({ v: 3, ids: ['chat-a'], preview: null, zones: ['chat-a', 'chat-vanished'] }),
    );
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = '__LOCALID_boot';
    const { rerender } = renderHook(() => useSessionTabsSync());

    mainThreadIdValue = 'chat-a';
    rerender();

    expect(switchToThread).not.toHaveBeenCalled();
    expect(zones()).toBeNull();
  });

  it('restores no split from a v2 payload that predates zones', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a', 'chat-b'], preview: null }));
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = '__LOCALID_boot';
    const { rerender } = renderHook(() => useSessionTabsSync());

    mainThreadIdValue = 'chat-a';
    rerender();

    expect(switchToThread).not.toHaveBeenCalled();
    expect(zones()).toBeNull();
    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a', 'chat-b']);
  });

  it('maps a persisted pair onto this boot runtime ids', () => {
    localStorage.setItem(
      SESSION_TABS_STORAGE_KEY,
      JSON.stringify({ v: 3, ids: ['chat-a', 'chat-b'], preview: null, zones: ['chat-b', 'chat-a'] }),
    );
    settledList([SESSION_A, SESSION_LOCAL_B]);
    mainThreadIdValue = '__LOCALID_boot';
    const { rerender } = renderHook(() => useSessionTabsSync());

    expect(switchToThread).toHaveBeenCalledWith('__LOCALID_5');

    mainThreadIdValue = '__LOCALID_5';
    rerender();

    expect(zones()).toEqual(['__LOCALID_5', 'chat-a']);
  });
});
