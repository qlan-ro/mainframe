/**
 * useSessionTabsSync — the split half of the persisted strip (`mf:session-tabs`
 * v3). The zone pair (and its divider fraction) is stored beside the tab ids,
 * in the same boot-stable id space. Restoring just SETS the pair — under the
 * parking model the split renders whenever the active chat is a member, so no
 * focus choreography is needed or performed.
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
  useZonesStore.setState({ zones: null, focusedIndex: 0, frac: 0.5 });
});

describe('writing the open split', () => {
  it('stores the pair beside the tab ids', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a', 'chat-b'], preview: null }));
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });

    renderHook(() => useSessionTabsSync());

    expect(readPersisted()).toEqual({
      v: 3,
      ids: ['chat-a', 'chat-b'],
      preview: null,
      zones: ['chat-a', 'chat-b'],
      zonesFrac: 0.5,
    });
  });

  it('stores a zone as its boot-stable remoteId, exactly like a tab', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a'], preview: null }));
    settledList([SESSION_A, SESSION_LOCAL_B]);
    mainThreadIdValue = 'chat-a';
    useZonesStore.setState({ zones: ['chat-a', '__LOCALID_5'], focusedIndex: 0 });

    renderHook(() => useSessionTabsSync());

    // The zone persists remote-keyed, but being held by the pair writes no pin.
    expect(readPersisted()).toEqual({
      v: 3,
      ids: ['chat-a'],
      preview: null,
      zones: ['chat-a', 'chat-b'],
      zonesFrac: 0.5,
    });
  });

  it('stores the divider fraction with the pair, rounded to 3 places', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 2, ids: ['chat-a', 'chat-b'], preview: null }));
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0, frac: 0.6180339 });

    renderHook(() => useSessionTabsSync());

    expect(readPersisted()).toEqual({
      v: 3,
      ids: ['chat-a', 'chat-b'],
      preview: null,
      zones: ['chat-a', 'chat-b'],
      zonesFrac: 0.618,
    });
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

    expect(readPersisted()).toEqual({ v: 3, ids: ['chat-a', 'chat-b'], preview: null, zones: [], zonesFrac: null });
  });
});

describe('a preview tab entering the split', () => {
  it('stays unpinned — membership holds a tab open, only a gesture pins it', () => {
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';
    useSessionTabsStore.setState({ tabIds: ['chat-a'], previewId: 'chat-b', hydrated: true });
    const { rerender } = renderHook(() => useSessionTabsSync());

    act(() => {
      useZonesStore.getState().openSplit('chat-a', 'chat-b');
    });
    rerender();

    expect(useSessionTabsStore.getState().previewId).toBe('chat-b');
    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a']);
  });

  it('a fork from a preview parent pins neither tab', () => {
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';
    const { rerender } = renderHook(() => useSessionTabsSync());
    act(() => {
      useZonesStore.getState().openSplit('chat-a', 'chat-b');
    });
    mainThreadIdValue = 'chat-b';
    rerender();

    expect(useSessionTabsStore.getState().tabIds).toEqual([]);
  });

  it('activating a parked member neither pins it nor replaces the preview', () => {
    settledList([SESSION_A, SESSION_B, { id: 'chat-c', status: 'regular', custom: {}, title: 'Third' }]);
    mainThreadIdValue = 'chat-c';
    useSessionTabsStore.setState({ tabIds: [], previewId: 'chat-c', hydrated: true });
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    const { rerender } = renderHook(() => useSessionTabsSync());

    mainThreadIdValue = 'chat-a';
    rerender();

    expect(useSessionTabsStore.getState().previewId).toBe('chat-c');
    expect(useSessionTabsStore.getState().tabIds).toEqual([]);
  });

  it('dissolving leaves the active member as the preview and drops the other', () => {
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-b';
    useSessionTabsStore.setState({ tabIds: [], previewId: null, hydrated: true });
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });
    const { rerender } = renderHook(() => useSessionTabsSync());
    expect(useSessionTabsStore.getState().previewId).toBeNull();

    act(() => {
      useZonesStore.getState().closeSplit();
    });
    rerender();

    const s = useSessionTabsStore.getState();
    expect(s.tabIds).toEqual([]);
    expect(s.previewId).toBe('chat-b');
  });

  it('an explicit pin survives the dissolve', () => {
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-b';
    useSessionTabsStore.setState({ tabIds: ['chat-a'], previewId: null, hydrated: true });
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 1 });
    const { rerender } = renderHook(() => useSessionTabsSync());

    act(() => {
      useZonesStore.getState().closeSplit();
    });
    rerender();

    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a']);
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

  it('sets the pair with NO focus choreography — rendering derives from membership (parking model)', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, V3_PAIR);
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = '__LOCALID_boot';

    renderHook(() => useSessionTabsSync());

    expect(switchToThread).not.toHaveBeenCalled();
    expect(zones()).toEqual(['chat-a', 'chat-b']);
  });

  it('restores the divider fraction with the pair; a payload without one keeps the even split', () => {
    localStorage.setItem(
      SESSION_TABS_STORAGE_KEY,
      JSON.stringify({ v: 3, ids: ['chat-a', 'chat-b'], preview: null, zones: ['chat-a', 'chat-b'], zonesFrac: 0.7 }),
    );
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';

    renderHook(() => useSessionTabsSync());

    expect(useZonesStore.getState().frac).toBe(0.7);
  });

  it('restores the pair only once — a user close later the same boot sticks', () => {
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, V3_PAIR);
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';
    const { rerender } = renderHook(() => useSessionTabsSync());

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

  it('a restored pair adds no members to the persisted ids', () => {
    localStorage.setItem(
      SESSION_TABS_STORAGE_KEY,
      JSON.stringify({ v: 3, ids: [], preview: null, zones: ['chat-a', 'chat-b'] }),
    );
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';

    renderHook(() => useSessionTabsSync());

    expect(useSessionTabsStore.getState().tabIds).toEqual([]);
    expect(readPersisted()).toMatchObject({ ids: [], zones: ['chat-a', 'chat-b'] });
  });

  it('maps a persisted pair onto this boot runtime ids', () => {
    localStorage.setItem(
      SESSION_TABS_STORAGE_KEY,
      JSON.stringify({ v: 3, ids: ['chat-a', 'chat-b'], preview: null, zones: ['chat-b', 'chat-a'] }),
    );
    settledList([SESSION_A, SESSION_LOCAL_B]);
    mainThreadIdValue = '__LOCALID_boot';

    renderHook(() => useSessionTabsSync());

    expect(zones()).toEqual(['__LOCALID_5', 'chat-a']);
  });
});
