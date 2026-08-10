/**
 * useSessionTabsSync — boot-race regression tests (TDD red phase, #312).
 *
 * The runtime seeds `threadItems` synchronously with the transient new-thread
 * draft before `adapter.list()` resolves. Hydration must wait for a list that
 * actually loaded (`useSessionListLoadState`), has SETTLED (isLoading === false)
 * and carries at least one real session before it maps persisted ids onto this
 * boot's runtime ids — otherwise it restores an empty set, latches, and the
 * persist effect overwrites `mf:session-tabs` with the survivors.
 */
import { it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { SESSION_TABS_STORAGE_KEY } from '../tabs-model';
import { useSessionTabsStore } from '../store';
import { useSessionListLoadState } from '@/features/sessions/runtime/list-load-state';

// ---------------------------------------------------------------------------
// Mutable module-scope state the mocked @assistant-ui/react selector reads.
// ---------------------------------------------------------------------------

let itemsValue: Array<{ id: string; status?: string; custom?: unknown; remoteId?: string }>;
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

function readPersistedIds(): string[] | null {
  const raw = localStorage.getItem(SESSION_TABS_STORAGE_KEY);
  if (!raw) return null;
  return (JSON.parse(raw) as { ids: string[] }).ids;
}

beforeEach(() => {
  itemsValue = [];
  isLoadingValue = true;
  mainThreadIdValue = null;
  localStorage.clear();
  useSessionTabsStore.setState({ tabIds: [], hydrated: false });
  useSessionListLoadState.setState({ loaded: false });
});

/** What `adapter.list()` returning does: latches the load flag the predicate gates on. */
function listSucceeded(): void {
  useSessionListLoadState.setState({ loaded: true });
}

it('does not latch hydrated against a loading, draft-only list (boot race)', () => {
  localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 1, ids: ['chat-a', 'chat-b'] }));
  isLoadingValue = true;
  itemsValue = [{ id: '__LOCALID_1', status: 'new' }];
  mainThreadIdValue = '__LOCALID_1';

  renderHook(() => useSessionTabsSync());

  expect(useSessionTabsStore.getState().hydrated).toBe(false);
  expect(readPersistedIds()).toEqual(['chat-a', 'chat-b']);
});

it('restores in persisted order once the list settles with real sessions', () => {
  localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 1, ids: ['chat-a', 'chat-b'] }));
  isLoadingValue = true;
  itemsValue = [{ id: '__LOCALID_1', status: 'new' }];
  mainThreadIdValue = '__LOCALID_1';
  const { rerender } = renderHook(() => useSessionTabsSync());

  itemsValue = [
    { id: 'chat-b', status: 'regular', custom: {} },
    { id: '__LOCALID_9', status: 'regular', remoteId: 'chat-a', custom: {} },
  ];
  isLoadingValue = false;
  mainThreadIdValue = 'chat-b';
  listSucceeded();
  rerender();

  const state = useSessionTabsStore.getState();
  expect(state.hydrated).toBe(true);
  expect(state.tabIds.slice(0, 2)).toEqual(['__LOCALID_9', 'chat-b']);
});

it('does not clobber a persisted payload with a settled draft-only list, and restores once real sessions arrive', () => {
  localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 1, ids: ['chat-a', 'chat-b'] }));
  isLoadingValue = false;
  itemsValue = [{ id: '__LOCALID_1', status: 'new' }];
  mainThreadIdValue = '__LOCALID_1';
  listSucceeded();
  const { rerender } = renderHook(() => useSessionTabsSync());

  expect(useSessionTabsStore.getState().hydrated).toBe(false);
  expect(readPersistedIds()).toEqual(['chat-a', 'chat-b']);

  itemsValue = [
    { id: 'chat-a', status: 'regular', custom: {} },
    { id: 'chat-b', status: 'regular', custom: {} },
  ];
  mainThreadIdValue = 'chat-a';
  rerender();

  const state = useSessionTabsStore.getState();
  expect(state.hydrated).toBe(true);
  expect(state.tabIds).toEqual(['chat-a', 'chat-b']);
});

it('keeps the payload through a failed load, a first send, and a deep-link fetch', () => {
  localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 1, ids: ['chat-a', 'chat-b'] }));
  isLoadingValue = false; // list() rejected: settled, but nothing was ever listed
  itemsValue = [{ id: '__LOCALID_1', status: 'new' }];
  mainThreadIdValue = '__LOCALID_1';
  const { rerender } = renderHook(() => useSessionTabsSync());

  // adapter.initialize() stamps the draft; the list itself is still the failed one.
  itemsValue = [{ id: '__LOCALID_1', status: 'regular', remoteId: 'chat-new' }];
  rerender();

  expect(useSessionTabsStore.getState().hydrated).toBe(false);
  expect(readPersistedIds()).toEqual(['chat-a', 'chat-b']);

  // A deep-link switchToThread injects ONE custom-carrying entry via adapter.fetch().
  itemsValue = [
    { id: '__LOCALID_1', status: 'regular', remoteId: 'chat-new' },
    { id: 'chat-a', status: 'regular', custom: {} },
  ];
  mainThreadIdValue = 'chat-a';
  rerender();

  expect(useSessionTabsStore.getState().hydrated).toBe(false);
  expect(readPersistedIds()).toEqual(['chat-a', 'chat-b']);

  // The chat.created reload succeeds and the real sessions arrive.
  itemsValue = [
    { id: '__LOCALID_1', status: 'regular', remoteId: 'chat-new' },
    { id: 'chat-a', status: 'regular', custom: {} },
    { id: 'chat-b', status: 'regular', custom: {} },
  ];
  listSucceeded();
  rerender();

  const state = useSessionTabsStore.getState();
  expect(state.hydrated).toBe(true);
  expect(state.tabIds).toEqual(['chat-a', 'chat-b', '__LOCALID_1']);
});

it('boots clean on a genuinely session-less install', () => {
  isLoadingValue = false;
  itemsValue = [{ id: '__LOCALID_1', status: 'new' }];
  mainThreadIdValue = '__LOCALID_1';
  listSucceeded();

  renderHook(() => useSessionTabsSync());

  const state = useSessionTabsStore.getState();
  expect(state.tabIds).toEqual(['__LOCALID_1']);
  expect(state.hydrated).toBe(false);
  expect(localStorage.getItem(SESSION_TABS_STORAGE_KEY)).toBeNull();
});
