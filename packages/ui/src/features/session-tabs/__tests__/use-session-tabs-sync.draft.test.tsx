/**
 * useSessionTabsSync — the draft tab's life: protected while unsent, temporary
 * once sent, and never a leftover from boot.
 *
 * Two drafts are indistinguishable by state — the runtime's transient boot
 * draft and the one the user created with "+" are both a `__LOCALID_*` entry
 * with status 'new'. What separates them is WHEN they were activated: the boot
 * draft is active before `adapter.list()` has ever returned, so the seam reads
 * the load flag at activation time and only protects a draft opened after it.
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

/** A settled, real list: what `adapter.list()` returning looks like to the hook. */
function settledList(items: typeof itemsValue): void {
  itemsValue = items;
  isLoadingValue = false;
  useSessionListLoadState.setState({ loaded: true });
}

const SESSION_A = { id: 'chat-a', status: 'regular', custom: {}, title: 'Fix the parser' };
const SESSION_B = { id: 'chat-b', status: 'regular', custom: {}, title: 'Write the docs' };
const DRAFT = { id: '__LOCALID_1', status: 'new' };

beforeEach(() => {
  itemsValue = [];
  isLoadingValue = true;
  mainThreadIdValue = null;
  localStorage.clear();
  useSessionTabsStore.setState({ tabIds: [], previewId: null, draftId: null, hydrated: false });
  useSessionListLoadState.setState({ loaded: false });
});

describe('an unsent draft', () => {
  it('opens in the protected draft slot, beside the peek it did not replace', () => {
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-b';
    const { rerender } = renderHook(() => useSessionTabsSync());

    itemsValue = [SESSION_A, SESSION_B, DRAFT];
    mainThreadIdValue = '__LOCALID_1';
    rerender();

    const state = useSessionTabsStore.getState();
    expect(state.draftId).toBe('__LOCALID_1');
    expect(state.previewId).toBe('chat-b');
    expect(state.tabIds).toEqual([]);
  });

  it('survives opening another session from the sidebar', () => {
    // The whole point of the slot: a peek must not throw away unsent typing.
    settledList([SESSION_A, SESSION_B, DRAFT]);
    mainThreadIdValue = '__LOCALID_1';
    const { rerender } = renderHook(() => useSessionTabsSync());

    mainThreadIdValue = 'chat-a';
    rerender();

    const state = useSessionTabsStore.getState();
    expect(state.draftId).toBe('__LOCALID_1');
    expect(state.previewId).toBe('chat-a');
  });
});

describe('the first send', () => {
  it('demotes the draft to the temporary slot, which the next session then replaces', () => {
    settledList([SESSION_A, SESSION_B, DRAFT]);
    mainThreadIdValue = '__LOCALID_1';
    const { rerender } = renderHook(() => useSessionTabsSync());

    // First send + chat.created reload: the local entry is remoteId-stamped, a
    // canonical entry lands, and the router hands the active thread over.
    itemsValue = [
      SESSION_A,
      SESSION_B,
      { id: '__LOCALID_1', status: 'regular', remoteId: 'chat-new' },
      { id: 'chat-new', status: 'regular', custom: {}, title: 'Ship the release' },
    ];
    mainThreadIdValue = 'chat-new';
    rerender();

    expect(useSessionTabsStore.getState()).toMatchObject({ tabIds: [], previewId: 'chat-new', draftId: null });

    // Clicking another session now dismisses it, like any temporary tab.
    mainThreadIdValue = 'chat-a';
    rerender();

    const state = useSessionTabsStore.getState();
    expect(state.previewId).toBe('chat-a');
    expect(state.tabIds).toEqual([]);
    expect(state.draftId).toBeNull();
  });

  it('leaves a draft the user kept open pinned, with the slot free for the next one', () => {
    settledList([SESSION_A, DRAFT]);
    mainThreadIdValue = '__LOCALID_1';
    const { rerender } = renderHook(() => useSessionTabsSync());
    useSessionTabsStore.getState().pinTab('__LOCALID_1');

    itemsValue = [
      SESSION_A,
      { id: '__LOCALID_1', status: 'regular', remoteId: 'chat-new' },
      { id: 'chat-new', status: 'regular', custom: {}, title: 'Ship the release' },
    ];
    mainThreadIdValue = 'chat-new';
    rerender();

    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual(['chat-new']);
    expect(state.previewId).toBeNull();
    expect(state.draftId).toBeNull();
  });
});

describe('the boot draft', () => {
  it('leaves no leftover tab once the list settles and a session is auto-selected', () => {
    // The runtime seeds a draft before `list()` resolves; it is not the user's
    // "+", so it peeks (and is replaced) instead of claiming the draft slot.
    itemsValue = [DRAFT];
    mainThreadIdValue = '__LOCALID_1';
    const { rerender } = renderHook(() => useSessionTabsSync());

    expect(useSessionTabsStore.getState().draftId).toBeNull();

    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';
    rerender();

    const state = useSessionTabsStore.getState();
    expect(state.previewId).toBe('chat-a');
    expect(state.draftId).toBeNull();
    expect(state.tabIds).toEqual([]);
  });

  it('does not eat the persisted preview when the list settles under it', () => {
    // The boot draft holds the preview slot only because nothing real is on
    // screen yet — unlike a deep-link peek, it must not outrank the restore.
    localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify({ v: 3, ids: ['chat-a'], preview: 'chat-b' }));
    itemsValue = [DRAFT];
    mainThreadIdValue = '__LOCALID_1';
    const { rerender } = renderHook(() => useSessionTabsSync());

    settledList([SESSION_A, SESSION_B, DRAFT]);
    rerender();

    const state = useSessionTabsStore.getState();
    expect(state.tabIds).toEqual(['chat-a']);
    expect(state.previewId).toBe('chat-b');
  });
});
