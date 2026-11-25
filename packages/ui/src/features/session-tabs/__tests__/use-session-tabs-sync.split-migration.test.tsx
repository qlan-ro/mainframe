/**
 * useSessionTabsSync — upgrade from split chats (W9). A v3 `mf:session-tabs`
 * payload holds the open pair's `zones`; v4 has none. Each member's workspace
 * gets the other as a chat tab, so opening either still shows both, and the pair
 * is dropped from storage.
 *
 * (The preview slot and the v1/v2 payloads live in
 * use-session-tabs-sync.preview.test.tsx.)
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionListLoadState } from '@/features/sessions/runtime/list-load-state';
import { useLayoutStore } from '@/store/layout';
import type { RunTab } from '@/store/run-pane';
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

const V3_PAIR = { v: 3, ids: ['chat-a', 'chat-b'], preview: null, zones: ['chat-a', 'chat-b'], zonesFrac: 0.62 };
const persist = (payload: unknown) => localStorage.setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify(payload));

/** What a session's workspace holds once it is the one on screen. */
function workspaceOf(sessionId: string): { tabs: RunTab[]; front: string | null; lit: boolean } {
  const store = useLayoutStore.getState();
  store.setActiveSession(sessionId);
  const { run, layout } = useLayoutStore.getState();
  return {
    tabs: run?.panes.flatMap((pane) => pane.tabs) ?? [],
    front: run?.panes[0]?.active ?? null,
    lit: layout.top.includes('workspace'),
  };
}

beforeEach(() => {
  itemsValue = [];
  isLoadingValue = true;
  mainThreadIdValue = null;
  switchToThread.mockReset();
  localStorage.clear();
  useSessionTabsStore.setState({ tabIds: [], previewId: null, hydrated: false });
  useSessionListLoadState.setState({ loaded: false });
  useLayoutStore.setState({
    layout: { top: ['chat'], topFlex: {} },
    run: null,
    sessions: new Map(),
    activeSessionId: null,
  });
});

describe('a persisted split pair', () => {
  it('becomes a chat tab, in front, in each of its sessions’ workspaces', () => {
    persist(V3_PAIR);
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';

    renderHook(() => useSessionTabsSync());

    const a = workspaceOf('chat-a');
    expect(a.lit).toBe(true);
    expect(a.front).toBe('chat-chat-b');
    expect(a.tabs).toEqual([
      { id: 'chat-chat-b', kind: 'chat', title: 'Write the docs', chatId: 'chat-b', role: 'session' },
    ]);
    const b = workspaceOf('chat-b');
    expect(b.lit).toBe(true);
    expect(b.tabs.map((tab) => tab.chatId)).toEqual(['chat-a']);
  });

  it('keeps what the workspaces already held', () => {
    persist(V3_PAIR);
    settledList([SESSION_A, SESSION_B]);
    const file: RunTab = { id: 'code-1', kind: 'code', title: 'a.ts', path: 'a.ts' };
    useLayoutStore.getState().setActiveSession('chat-a');
    useLayoutStore.getState().addRunTab(file);

    renderHook(() => useSessionTabsSync());

    expect(workspaceOf('chat-a').tabs.map((tab) => tab.id)).toEqual(['code-1', 'chat-chat-b']);
  });

  it('keeps both members as pinned session tabs, even one whose own tab was not stored', () => {
    persist({ ...V3_PAIR, ids: ['chat-a'], preview: 'chat-b' });
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';

    renderHook(() => useSessionTabsSync());

    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a', 'chat-b']);
    expect(useSessionTabsStore.getState().previewId).toBeNull();
  });

  it('names a fork as one', () => {
    persist(V3_PAIR);
    settledList([SESSION_A, { ...SESSION_B, custom: { parentChatId: 'chat-a' } }]);

    renderHook(() => useSessionTabsSync());

    expect(workspaceOf('chat-a').tabs[0]!.role).toBe('fork');
    expect(workspaceOf('chat-b').tabs[0]!.role).toBe('session');
  });

  it('is keyed by daemon ids, whatever this boot calls the sessions', () => {
    persist(V3_PAIR);
    settledList([SESSION_A, SESSION_LOCAL_B]);

    renderHook(() => useSessionTabsSync());

    expect(workspaceOf('chat-a').tabs.map((tab) => tab.chatId)).toEqual(['chat-b']);
    expect(workspaceOf('chat-b').tabs.map((tab) => tab.chatId)).toEqual(['chat-a']);
  });

  it('is written back without the pair, so it happens once', () => {
    persist(V3_PAIR);
    settledList([SESSION_A, SESSION_B]);
    mainThreadIdValue = 'chat-a';
    renderHook(() => useSessionTabsSync());
    expect(readPersisted()).toEqual({ v: 4, ids: ['chat-a', 'chat-b'], preview: null });
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('waits for the real list: nothing is migrated, and nothing lost, while it loads', () => {
    persist(V3_PAIR);
    itemsValue = [SESSION_A, SESSION_B];
    const { rerender } = renderHook(() => useSessionTabsSync());
    expect(readPersisted()).toEqual(V3_PAIR);

    settledList([SESSION_A, SESSION_B]);
    rerender();
    expect(workspaceOf('chat-a').tabs.map((tab) => tab.chatId)).toEqual(['chat-b']);
  });

  it('has nothing to show once one of the two is gone', () => {
    persist({ ...V3_PAIR, ids: ['chat-a'], zones: ['chat-a', 'chat-vanished'] });
    settledList([SESSION_A, SESSION_B]);

    renderHook(() => useSessionTabsSync());

    expect(workspaceOf('chat-a')).toEqual({ tabs: [], front: null, lit: false });
    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a']);
  });

  it('is absent from a v2 payload, which restores its tabs as before', () => {
    persist({ v: 2, ids: ['chat-a', 'chat-b'], preview: null });
    settledList([SESSION_A, SESSION_B]);

    renderHook(() => useSessionTabsSync());

    expect(useSessionTabsStore.getState().tabIds).toEqual(['chat-a', 'chat-b']);
    expect(workspaceOf('chat-a').tabs).toEqual([]);
  });
});
