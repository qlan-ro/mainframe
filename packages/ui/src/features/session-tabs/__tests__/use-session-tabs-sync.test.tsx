/**
 * useSessionTabsSync — boot-race regression tests (TDD red phase, #312), plus
 * a first-send identity-handoff describe (TDD red phase, #319).
 *
 * The runtime seeds `threadItems` synchronously with the transient new-thread
 * draft before `adapter.list()` resolves. Hydration must wait for a list that
 * actually loaded (`useSessionListLoadState`), has SETTLED (isLoading === false)
 * and carries at least one real session before it maps persisted ids onto this
 * boot's runtime ids — otherwise it restores an empty set, latches, and the
 * persist effect overwrites `mf:session-tabs` with the survivors.
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

/**
 * first-send identity handoff — TDD red phase, #319.
 *
 * The seam opens a tab for whatever thread becomes active. On first send the
 * local entry is remoteId-stamped and a SECOND, canonical entry appears; the
 * router later hands the active thread to that canonical entry, so the seam
 * would open a tab for it too unless something collapses the two identities
 * into the slot the draft tab already held. These cases pin the collapse and
 * are expected to fail until task 7 (the sync hook) reconciles instead of
 * pruning — the pre-existing #312 cases above must stay green throughout.
 */
describe('first-send identity handoff', () => {
  it('collapses the orphaned draft onto the canonical session, in place, across repeated sessions', () => {
    useSessionTabsStore.setState({ tabIds: ['chat-a'] });
    itemsValue = [
      { id: 'chat-a', status: 'regular', custom: {} },
      { id: '__LOCALID_9', status: 'new' },
    ];
    isLoadingValue = false;
    mainThreadIdValue = '__LOCALID_9';
    listSucceeded();
    const { rerender } = renderHook(() => useSessionTabsSync());

    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a', '__LOCALID_9']);

    // First send + chat.created reload: the local entry is remoteId-stamped and
    // a second, canonical entry lands — but the router has not handed the
    // active thread over yet.
    itemsValue = [
      { id: 'chat-a', status: 'regular', custom: {} },
      { id: '__LOCALID_9', status: 'regular', remoteId: 'chat-new' },
      { id: 'chat-new', status: 'regular', custom: {}, title: 'Fix the parser' },
    ];
    rerender();

    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a', 'chat-new']);

    // The router's handover lands; nothing changes — the seam appends the
    // canonical id, and reconciliation collapses it in the same flush.
    mainThreadIdValue = 'chat-new';
    rerender();

    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a', 'chat-new']);

    // A second session runs the same dance: N sessions leaves N tabs, not 2N.
    itemsValue = [...itemsValue, { id: '__LOCALID_10', status: 'new' }];
    mainThreadIdValue = '__LOCALID_10';
    rerender();

    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a', 'chat-new', '__LOCALID_10']);

    itemsValue = [
      { id: 'chat-a', status: 'regular', custom: {} },
      { id: '__LOCALID_9', status: 'regular', remoteId: 'chat-new' },
      { id: 'chat-new', status: 'regular', custom: {}, title: 'Fix the parser' },
      { id: '__LOCALID_10', status: 'regular', remoteId: 'chat-two' },
      { id: 'chat-two', status: 'regular', custom: {}, title: 'Second session' },
    ];
    mainThreadIdValue = 'chat-two';
    rerender();

    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a', 'chat-new', 'chat-two']);
    expect(readPersistedIds()).toEqual(['chat-a', 'chat-new', 'chat-two']);
  });

  it('collapses an already-open ghost without waiting for hydration', () => {
    // Pins decision 3: a failed list load must not strand a ghost forever.
    itemsValue = [
      { id: '__LOCALID_9', status: 'regular', remoteId: 'chat-new' },
      { id: 'chat-new', status: 'regular', custom: {}, title: 'Fix the parser' },
    ];
    mainThreadIdValue = '__LOCALID_9';
    useSessionTabsStore.setState({ tabIds: ['__LOCALID_9'] });

    renderHook(() => useSessionTabsSync());

    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-new']);
    expect(useSessionTabsStore.getState().hydrated).toBe(false);
  });
});
