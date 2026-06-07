/**
 * useSessionListRouter — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - wires the router once with a deps object that has onReload / onChatUpdated /
 *    onMarkUnread functions
 *  - onReload → calls runtime.threads.reload()
 *  - onChatUpdated → calls runtime.threads.reload() (corrected contract: reload,
 *    not a surgical patch)
 *  - onMarkUnread → calls unreadStore.markUnread with the chatId
 *  - active thread change → calls clearUnread with the active id
 *  - cross-project activate → calls setFilterProjectId(null)
 *  - same-project activate → does NOT call setFilterProjectId
 *  - null filter → does NOT call setFilterProjectId
 *  - archived-active → calls switchToThread with first non-archived thread id
 *  - archived-active with no other thread → does NOT call switchToThread
 *  - unmount → calls router.dispose() exactly once
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Chat } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Spy declarations — module-scope lets reset in beforeEach
// ---------------------------------------------------------------------------

let markUnreadSpy: ReturnType<typeof vi.fn>;
let clearUnreadSpy: ReturnType<typeof vi.fn>;
let setFilterProjectIdSpy: ReturnType<typeof vi.fn>;
let switchSpy: ReturnType<typeof vi.fn>;
let reloadSpy: ReturnType<typeof vi.fn>;

// Values that tests can mutate before re-render to control hook behaviour
let filterProjectIdValue: string | null;
let mainThreadIdValue: string | null;
let fakeThreadItems: Array<{ id: string; remoteId: string; status?: string; custom?: { projectId?: string } }>;

// Captured from the createSessionListRouter factory mock
let capturedDeps: {
  onReload: () => void;
  onChatUpdated: (chat: Chat) => void;
  onMarkUnread: (id: string) => void;
};

// Tracks how many times the factory was called across renders
let factoryCallCount: number;

// The dispose spy returned by the mocked factory
let disposeSpy: ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Mocks — vi.mock factories are hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('../../../../lib/daemon/ws-client', () => ({
  daemonWs: { onEvent: vi.fn(() => () => {}) },
}));

vi.mock('../session-list-router', () => ({
  createSessionListRouter: vi.fn((_ws: unknown, deps: typeof capturedDeps) => {
    capturedDeps = deps;
    factoryCallCount += 1;
    return { dispose: disposeSpy };
  }),
}));

vi.mock('../../../../store/unread-store', () => ({
  useUnreadStore: Object.assign(vi.fn(), {
    getState: () => ({ markUnread: markUnreadSpy, clearUnread: clearUnreadSpy }),
  }),
}));

vi.mock('../../../../store/session-filters', () => ({
  useSessionFilters: Object.assign(vi.fn(), {
    getState: () => ({
      filterProjectId: filterProjectIdValue,
      setFilterProjectId: setFilterProjectIdSpy,
    }),
  }),
}));

vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@assistant-ui/react')>('@assistant-ui/react');
  return {
    ...actual,
    useAssistantRuntime: () => ({
      threads: {
        reload: reloadSpy,
        switchToThread: switchSpy,
        getState: () => ({ threads: fakeThreadItems }),
      },
    }),
    useAuiState: (
      sel: (s: { threads: { mainThreadId: string | null; threadItems: typeof fakeThreadItems } }) => unknown,
    ) => sel({ threads: { mainThreadId: mainThreadIdValue, threadItems: fakeThreadItems } }),
  };
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useSessionListRouter } from '../use-session-list-router';

// ---------------------------------------------------------------------------
// Reset all spies / values before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  markUnreadSpy = vi.fn();
  clearUnreadSpy = vi.fn();
  setFilterProjectIdSpy = vi.fn();
  switchSpy = vi.fn();
  reloadSpy = vi.fn();
  disposeSpy = vi.fn();

  filterProjectIdValue = null;
  mainThreadIdValue = null;
  fakeThreadItems = [];
  factoryCallCount = 0;
});

// ---------------------------------------------------------------------------
// 1. wires the router exactly once with a deps object
// ---------------------------------------------------------------------------

describe('useSessionListRouter — wires the router once with deps', () => {
  it('calls createSessionListRouter exactly once and captures function-typed deps', () => {
    renderHook(() => useSessionListRouter());

    expect(factoryCallCount).toBe(1);
    expect(typeof capturedDeps.onReload).toBe('function');
    expect(typeof capturedDeps.onChatUpdated).toBe('function');
    expect(typeof capturedDeps.onMarkUnread).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 2. onReload → runtime.threads.reload()
// ---------------------------------------------------------------------------

describe('useSessionListRouter — onReload triggers runtime reload', () => {
  it('calls reloadSpy exactly once when capturedDeps.onReload() is invoked', () => {
    renderHook(() => useSessionListRouter());

    act(() => {
      capturedDeps.onReload();
    });

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. onChatUpdated → runtime.threads.reload() (corrected contract)
// ---------------------------------------------------------------------------

describe('useSessionListRouter — onChatUpdated triggers runtime reload', () => {
  it('calls reloadSpy exactly once when capturedDeps.onChatUpdated() is invoked', () => {
    renderHook(() => useSessionListRouter());

    act(() => {
      capturedDeps.onChatUpdated({ id: 'c2' } as Chat);
    });

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4. onMarkUnread → store.markUnread(chatId)
// ---------------------------------------------------------------------------

describe('useSessionListRouter — onMarkUnread delegates to unread store', () => {
  it('calls markUnreadSpy with "c3" when capturedDeps.onMarkUnread("c3") is invoked', () => {
    renderHook(() => useSessionListRouter());

    act(() => {
      capturedDeps.onMarkUnread('c3');
    });

    expect(markUnreadSpy).toHaveBeenCalledTimes(1);
    expect(markUnreadSpy).toHaveBeenCalledWith('c3');
  });
});

// ---------------------------------------------------------------------------
// 5. active thread change → clearUnread(activeId)
// ---------------------------------------------------------------------------

describe('useSessionListRouter — active thread change clears unread', () => {
  it('calls clearUnreadSpy with "chat-A" when mainThreadId becomes "chat-A"', () => {
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p1' } }];

    renderHook(() => useSessionListRouter());

    expect(clearUnreadSpy).toHaveBeenCalledWith('chat-A');
  });
});

// ---------------------------------------------------------------------------
// 6. cross-project activate → setFilterProjectId(null)
// ---------------------------------------------------------------------------

describe('useSessionListRouter — cross-project activate clears project filter', () => {
  it('calls setFilterProjectIdSpy(null) when active chat is in a different project', () => {
    filterProjectIdValue = 'p-OLD';
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p-NEW' } }];

    renderHook(() => useSessionListRouter());

    expect(setFilterProjectIdSpy).toHaveBeenCalledTimes(1);
    expect(setFilterProjectIdSpy).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// 7. same-project activate → does NOT call setFilterProjectId
// ---------------------------------------------------------------------------

describe('useSessionListRouter — same-project activate does not clear filter', () => {
  it('does NOT call setFilterProjectIdSpy when active chat is in the same project', () => {
    filterProjectIdValue = 'p-NEW';
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p-NEW' } }];

    renderHook(() => useSessionListRouter());

    expect(setFilterProjectIdSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. null filter → does NOT call setFilterProjectId
// ---------------------------------------------------------------------------

describe('useSessionListRouter — null filter never calls setFilterProjectId', () => {
  it('does NOT call setFilterProjectIdSpy when filterProjectId is null', () => {
    filterProjectIdValue = null;
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p-NEW' } }];

    renderHook(() => useSessionListRouter());

    expect(setFilterProjectIdSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. archived-active → switchToThread(firstNonArchivedId)
// ---------------------------------------------------------------------------

describe('useSessionListRouter — archived active thread triggers fallback', () => {
  it('calls switchSpy with "chat-B" (first non-archived thread) when active is archived', () => {
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'archived', custom: { projectId: 'p1' } },
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1' } },
    ];

    renderHook(() => useSessionListRouter());

    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith('chat-B');
  });
});

// ---------------------------------------------------------------------------
// 10. archived-active with no other thread → switchSpy NOT called
// ---------------------------------------------------------------------------

describe('useSessionListRouter — archived active with no fallback thread', () => {
  it('does NOT call switchSpy when the only thread is the archived active one', () => {
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', status: 'archived', custom: { projectId: 'p1' } }];

    renderHook(() => useSessionListRouter());

    expect(switchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 11. unmount → dispose() called once
// ---------------------------------------------------------------------------

describe('useSessionListRouter — dispose is called on unmount', () => {
  it('calls disposeSpy exactly once when the hook unmounts', () => {
    const { unmount } = renderHook(() => useSessionListRouter());

    unmount();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 12. onMarkUnread is a no-op for the currently active thread (MED-5)
// ---------------------------------------------------------------------------

describe('useSessionListRouter — onMarkUnread for active thread is a no-op', () => {
  it('does NOT call markUnreadSpy when the marked id matches the active mainThreadId', () => {
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p1' } }];

    renderHook(() => useSessionListRouter());

    act(() => {
      capturedDeps.onMarkUnread('chat-A');
    });

    expect(markUnreadSpy).not.toHaveBeenCalled();
  });

  it('calls markUnreadSpy when the marked id is NOT the active mainThreadId', () => {
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p1' } },
      { id: 'chat-B', remoteId: 'chat-B', custom: { projectId: 'p1' } },
    ];

    renderHook(() => useSessionListRouter());

    act(() => {
      capturedDeps.onMarkUnread('chat-B');
    });

    expect(markUnreadSpy).toHaveBeenCalledTimes(1);
    expect(markUnreadSpy).toHaveBeenCalledWith('chat-B');
  });
});
