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
 *  - onOsNotify → calls the host bridge's notify(), even on the active thread
 *  - active thread change → calls clearUnread with the active id
 *  - cross-project activate (scope set, does not contain the project) → calls clearProjectFilter()
 *  - same-project activate → does NOT call clearProjectFilter
 *  - the project is among several scoped projects → does NOT call clearProjectFilter
 *  - empty scope → does NOT call clearProjectFilter
 *  - archived-active → calls switchToThread with most-recently-updated non-archived thread id
 *  - archived-active with no other thread → does NOT call switchToThread
 *  - unmount → calls router.dispose() exactly once
 *  - active thread change → restores that session's persisted workspace layout
 *  - activating a never-visited session → seeds it with INITIAL_LAYOUT
 *  - activating a __LOCALID_* draft → makes it the layout store's active session
 *    with a chat-only arrangement (todo #354)
 *  - a workspace toggle made while on the draft leaves the previously active
 *    chat's remembered entry untouched
 *  - the first-send handoff adopts the draft's layout entry onto the remote id
 *  - a draft never writes lastSessionId / lastForProject
 *  - a burst of onReload() calls coalesces into a leading reload plus at most
 *    one trailing reload per 200ms window, not one reload per event
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '../../../../store/layout';
import { useZonesStore } from '../../../chat/zones/zones-store';
import { useDraftReturnTarget } from '../../new-thread/use-draft-return-target';

// ---------------------------------------------------------------------------
// Spy declarations — module-scope lets reset in beforeEach
// ---------------------------------------------------------------------------

let markUnreadSpy: ReturnType<typeof vi.fn>;
let clearUnreadSpy: ReturnType<typeof vi.fn>;
let clearProjectFilterSpy: ReturnType<typeof vi.fn>;
let switchSpy: ReturnType<typeof vi.fn<(id: string) => void>>;
let reloadSpy: ReturnType<typeof vi.fn<() => void>>;
let itemDeleteSpy: ReturnType<typeof vi.fn<(id: string) => unknown>>;

// Values that tests can mutate before re-render to control hook behaviour
let filterProjectIdsValue: Set<string>;
let mainThreadIdValue: string | null;
let lastSessionIdValue: string | null;
let setLastSessionIdSpy: ReturnType<typeof vi.fn>;
let setLastForProjectSpy: ReturnType<typeof vi.fn>;
let fakeThreadItems: Array<{
  id: string;
  remoteId?: string;
  status?: string;
  custom?: { projectId?: string; updatedAt?: number };
}>;

let notifySpy: ReturnType<typeof vi.fn<(title: string, body?: string) => Promise<void>>>;

// Local ids the boot-select effect must treat as "a create is still open for
// this draft" (todo #346 — see the mock below).
let inFlightLocalIds: Set<string>;

// Captured from the createSessionListRouter factory mock
let capturedDeps: {
  onReload: () => void;
  onChatUpdated: (chat: Chat) => void;
  onMarkUnread: (id: string) => void;
  onOsNotify: (title: string, body: string) => void;
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

vi.mock('../../../../lib/host', () => ({
  getHost: () => ({ notify: (title: string, body?: string) => notifySpy(title, body) }),
}));

vi.mock('../../../../store/unread-store', () => ({
  useUnreadStore: Object.assign(vi.fn(), {
    getState: () => ({ markUnread: markUnreadSpy, clearUnread: clearUnreadSpy }),
  }),
}));

vi.mock('../../../../store/session-filters', () => ({
  useSessionFilters: Object.assign(vi.fn(), {
    getState: () => ({
      filterProjectIds: filterProjectIdsValue,
      clearProjectFilter: clearProjectFilterSpy,
    }),
  }),
}));

vi.mock('../../../../store/last-session', () => ({
  useLastSessionStore: Object.assign(vi.fn(), {
    getState: () => ({
      lastSessionId: lastSessionIdValue,
      setLastSessionId: setLastSessionIdSpy,
      // Active-thread change persists BOTH the global last session and the
      // per-project last session (use-session-list-router calls setLastForProject
      // when the active thread carries a projectId).
      setLastForProject: setLastForProjectSpy,
    }),
  }),
}));

vi.mock('../../runtime/new-thread-coordinator', () => ({
  isCreateInFlight: (localId: string) => inFlightLocalIds.has(localId),
}));

vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@assistant-ui/react')>('@assistant-ui/react');
  // One stable `threads` SCOPE across renders — the real scope survives a main-
  // thread switch even though the client wrapping it does not, and the WS wiring
  // effect depends on that stability (session-list-router-lifetime.test.tsx pins
  // it against the real runtime). The methods delegate rather than capture, so
  // beforeEach's spy reassignment still lands.
  const threads = {
    reload: () => reloadSpy(),
    switchToThread: (id: string) => switchSpy(id),
    item: (query: { id: string }) => ({ delete: () => itemDeleteSpy(query.id) }),
  };
  const auiClient = { threads };
  return {
    ...actual,
    useAui: () => auiClient,
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
  clearProjectFilterSpy = vi.fn();
  switchSpy = vi.fn();
  reloadSpy = vi.fn();
  itemDeleteSpy = vi.fn().mockResolvedValue(undefined);
  disposeSpy = vi.fn();
  notifySpy = vi.fn().mockResolvedValue(undefined);

  filterProjectIdsValue = new Set();
  mainThreadIdValue = null;
  inFlightLocalIds = new Set();
  lastSessionIdValue = null;
  setLastSessionIdSpy = vi.fn();
  setLastForProjectSpy = vi.fn();
  fakeThreadItems = [];
  factoryCallCount = 0;

  // Real stores (not mocked in this file) — reset to a clean slate each test.
  useLayoutStore.setState({ sessions: new Map(), activeSessionId: null });
  useZonesStore.setState({ zones: null, focusedIndex: 0 });
  useDraftReturnTarget.setState({ returnThreadId: null });
});

it('calls createSessionListRouter exactly once and captures function-typed deps', () => {
  renderHook(() => useSessionListRouter());

  expect(factoryCallCount).toBe(1);
  expect(typeof capturedDeps.onReload).toBe('function');
  expect(typeof capturedDeps.onChatUpdated).toBe('function');
  expect(typeof capturedDeps.onMarkUnread).toBe('function');
});

it('calls reloadSpy exactly once when capturedDeps.onReload() is invoked', () => {
  renderHook(() => useSessionListRouter());

  act(() => {
    capturedDeps.onReload();
  });

  expect(reloadSpy).toHaveBeenCalledTimes(1);
});

it('calls reloadSpy exactly once when capturedDeps.onChatUpdated() is invoked', () => {
  renderHook(() => useSessionListRouter());

  act(() => {
    capturedDeps.onChatUpdated({ id: 'c2' } as Chat);
  });

  expect(reloadSpy).toHaveBeenCalledTimes(1);
});

it('calls markUnreadSpy with "c3" when capturedDeps.onMarkUnread("c3") is invoked', () => {
  renderHook(() => useSessionListRouter());

  act(() => {
    capturedDeps.onMarkUnread('c3');
  });

  expect(markUnreadSpy).toHaveBeenCalledTimes(1);
  expect(markUnreadSpy).toHaveBeenCalledWith('c3');
});

// ---------------------------------------------------------------------------
// onReload coalescing: a burst of events must not become a refetch storm.
// capturedDeps.onReload IS the hook's live scheduleReload closure (the mocked
// createSessionListRouter factory captures the real deps object), so this
// drives the actual debounce with no extra mocking.
// ---------------------------------------------------------------------------

describe('useSessionListRouter — onReload coalesces a burst into leading + one trailing reload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses three synchronous calls into a leading reload, then one trailing reload after 200ms, then none', () => {
    renderHook(() => useSessionListRouter());

    act(() => {
      capturedDeps.onReload();
      capturedDeps.onReload();
      capturedDeps.onReload();
    });
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(reloadSpy).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(reloadSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// onOsNotify → host.notify(), unguarded by the active-thread check
// ---------------------------------------------------------------------------

describe('useSessionListRouter — attention requests reach the host bridge', () => {
  it('notifies the OS for the ACTIVE thread while markUnread stays suppressed', () => {
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p1' } }];

    renderHook(() => useSessionListRouter());

    act(() => {
      capturedDeps.onOsNotify('Claude needs your attention', 'Which database should I migrate?');
      capturedDeps.onMarkUnread('chat-A');
    });

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith('Claude needs your attention', 'Which database should I migrate?');
    expect(markUnreadSpy).not.toHaveBeenCalled();
  });

  it('warns instead of rejecting when the host bridge fails to notify', async () => {
    notifySpy = vi.fn().mockRejectedValue(new Error('no permission'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderHook(() => useSessionListRouter());

    act(() => {
      capturedDeps.onOsNotify('Claude needs your attention', 'Ping');
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// active thread change → clearUnread(activeId)
// ---------------------------------------------------------------------------

describe('useSessionListRouter — active thread change clears unread', () => {
  it('calls clearUnreadSpy with "chat-A" when mainThreadId becomes "chat-A"', () => {
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p1' } }];

    renderHook(() => useSessionListRouter());

    expect(clearUnreadSpy).toHaveBeenCalledWith('chat-A');
  });

  it('clears both the stable active id and remoteId when they differ', () => {
    mainThreadIdValue = 'thread-A';
    fakeThreadItems = [{ id: 'thread-A', remoteId: 'chat-A', custom: { projectId: 'p1' } }];

    renderHook(() => useSessionListRouter());

    expect(clearUnreadSpy).toHaveBeenCalledWith('thread-A');
    expect(clearUnreadSpy).toHaveBeenCalledWith('chat-A');
  });
});

it('calls clearProjectFilterSpy when the scope is set and does not contain the active chat’s project', () => {
  filterProjectIdsValue = new Set(['p-OLD']);
  mainThreadIdValue = 'chat-A';
  fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p-NEW' } }];

  renderHook(() => useSessionListRouter());

  expect(clearProjectFilterSpy).toHaveBeenCalledTimes(1);
});

it('does NOT call clearProjectFilterSpy when the scope already contains the active chat’s project', () => {
  filterProjectIdsValue = new Set(['p-NEW']);
  mainThreadIdValue = 'chat-A';
  fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p-NEW' } }];

  renderHook(() => useSessionListRouter());

  expect(clearProjectFilterSpy).not.toHaveBeenCalled();
});

it('does NOT call clearProjectFilterSpy when the scope contains the active project among others', () => {
  filterProjectIdsValue = new Set(['p-OTHER', 'p-NEW']);
  mainThreadIdValue = 'chat-A';
  fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p-NEW' } }];

  renderHook(() => useSessionListRouter());

  expect(clearProjectFilterSpy).not.toHaveBeenCalled();
});

it('does NOT call clearProjectFilterSpy when the scope is empty', () => {
  filterProjectIdsValue = new Set();
  mainThreadIdValue = 'chat-A';
  fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p-NEW' } }];

  renderHook(() => useSessionListRouter());

  expect(clearProjectFilterSpy).not.toHaveBeenCalled();
});

it('calls switchSpy with the most-recently-updated non-archived thread (not list order)', () => {
  mainThreadIdValue = 'chat-A';
  // chat-B comes FIRST in list order but chat-C has the newer updatedAt —
  // the fallback must match desktop and pick the most recently used session.
  fakeThreadItems = [
    { id: 'chat-A', remoteId: 'chat-A', status: 'archived', custom: { projectId: 'p1', updatedAt: 3000 } },
    { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1', updatedAt: 1000 } },
    { id: 'chat-C', remoteId: 'chat-C', status: 'regular', custom: { projectId: 'p1', updatedAt: 2000 } },
  ];

  renderHook(() => useSessionListRouter());

  expect(switchSpy).toHaveBeenCalledTimes(1);
  expect(switchSpy).toHaveBeenCalledWith('chat-C');
});

// ---------------------------------------------------------------------------
// archived-active under a project filter → fallback stays in the project
// ---------------------------------------------------------------------------

describe('useSessionListRouter — archived-active fallback respects the project filter', () => {
  it('picks the most-recent session IN the filtered project even when another project has a newer one', () => {
    filterProjectIdsValue = new Set(['p1']);
    mainThreadIdValue = 'chat-A';
    // chat-OTHER (p2) is the newest overall, but the filter is on p1 —
    // the fallback must pick chat-B (newest within p1).
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'archived', custom: { projectId: 'p1', updatedAt: 4000 } },
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1', updatedAt: 1000 } },
      { id: 'chat-OTHER', remoteId: 'chat-OTHER', status: 'regular', custom: { projectId: 'p2', updatedAt: 9000 } },
    ];

    renderHook(() => useSessionListRouter());

    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith('chat-B');
  });

  it('falls back to the most-recent session overall when the filtered project has none left', () => {
    filterProjectIdsValue = new Set(['p1']);
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'archived', custom: { projectId: 'p1', updatedAt: 4000 } },
      { id: 'chat-X', remoteId: 'chat-X', status: 'regular', custom: { projectId: 'p2', updatedAt: 1000 } },
      { id: 'chat-Y', remoteId: 'chat-Y', status: 'regular', custom: { projectId: 'p3', updatedAt: 2000 } },
    ];

    renderHook(() => useSessionListRouter());

    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith('chat-Y');
  });

  it('picks the most-recent session in EITHER of two scoped projects', () => {
    filterProjectIdsValue = new Set(['p1', 'p2']);
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'archived', custom: { projectId: 'p1', updatedAt: 4000 } },
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p2', updatedAt: 1000 } },
      { id: 'chat-OTHER', remoteId: 'chat-OTHER', status: 'regular', custom: { projectId: 'p3', updatedAt: 9000 } },
    ];

    renderHook(() => useSessionListRouter());

    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith('chat-B');
  });
});

it('does NOT call switchSpy when the only thread is the archived active one', () => {
  mainThreadIdValue = 'chat-A';
  fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', status: 'archived', custom: { projectId: 'p1' } }];

  renderHook(() => useSessionListRouter());

  expect(switchSpy).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Archive of the ACTIVE session: aui switchToNewThread()s off it FIRST, so
//   mainThreadId becomes a fresh __LOCALID_* draft while the session it left is
//   now archived. The router must redirect to a fallback, not strand the user on
//   the empty new-thread surface.
// ---------------------------------------------------------------------------

describe('useSessionListRouter — archiving the active session redirects off the empty draft', () => {
  it('switches to the most-recent non-archived session after aui bumps to a new draft', () => {
    // 1) Active on chat-A — establishes it as the last real (non-draft) thread.
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1', updatedAt: 2000 } },
    ];
    const { rerender } = renderHook(() => useSessionListRouter());
    switchSpy.mockClear();

    // 2) Archive chat-A: mainThreadId becomes a fresh draft; chat-A is now archived.
    mainThreadIdValue = '__LOCALID_new';
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'archived', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1', updatedAt: 2000 } },
    ];
    rerender();

    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith('chat-B');
  });

  it('switches to a fallback when the left session has vanished entirely — a discard, not just an archive (todo #346)', () => {
    // A discard routes through aui's delete(), which removes the entry from
    // threadData outright rather than flagging it 'archived' — the departed-
    // thread check must catch "gone from the list", not only "status: archived".
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1', updatedAt: 2000 } },
    ];
    const { rerender } = renderHook(() => useSessionListRouter());
    switchSpy.mockClear();

    // chat-A discarded: aui bumps to a fresh draft, and chat-A no longer
    // appears in threadItems at all (not even as 'archived').
    mainThreadIdValue = '__LOCALID_new';
    fakeThreadItems = [
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1', updatedAt: 2000 } },
    ];
    rerender();

    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith('chat-B');
  });

  it('does NOT redirect when the user deliberately opens a New thread (left session still regular)', () => {
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1', updatedAt: 2000 } },
    ];
    const { rerender } = renderHook(() => useSessionListRouter());
    switchSpy.mockClear();

    // User clicks New → draft, but chat-A stays 'regular' (nothing was archived).
    mainThreadIdValue = '__LOCALID_new';
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1', updatedAt: 2000 } },
    ];
    rerender();

    expect(switchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A deliberate New (todo #346) must not let a LATER,
// unrelated archive/discard of the thread it came from yank the user off the
// draft they opened and started typing into on purpose.
// ---------------------------------------------------------------------------

describe('useSessionListRouter — a deliberate New stops watching the thread it came from', () => {
  it('does NOT redirect when the thread a deliberate New came from is later discarded', () => {
    // 1) Active on chat-T — establishes it as the last real thread.
    mainThreadIdValue = 'chat-T';
    fakeThreadItems = [
      { id: 'chat-T', remoteId: 'chat-T', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1', updatedAt: 2000 } },
    ];
    const { rerender } = renderHook(() => useSessionListRouter());
    switchSpy.mockClear();

    // 2) Deliberate New away from chat-T: useStartNewSession stamps chat-T as
    // the draft's return target before switching (real behavior, reproduced
    // here rather than mocked, since the store isn't mocked in this file).
    useDraftReturnTarget.getState().setReturnTarget('chat-T');
    mainThreadIdValue = '__LOCALID_new';
    fakeThreadItems = [
      { id: 'chat-T', remoteId: 'chat-T', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1', updatedAt: 2000 } },
    ];
    rerender();
    expect(switchSpy).not.toHaveBeenCalled(); // still just a deliberate New — unaffected

    // 3) chat-T is discarded from the sidebar while the user is on the draft —
    // vanishes from the list entirely. Without that guard this matches the old
    // prevRealActiveId and redirects the user off their draft.
    fakeThreadItems = [
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1', updatedAt: 2000 } },
    ];
    rerender();

    expect(switchSpy).not.toHaveBeenCalled();
  });

  it('still redirects when the active session is archived/discarded WITHOUT a deliberate New', () => {
    // No draft return target is ever set here — aui bumps to a fresh draft on
    // its own when the active thread itself is archived/discarded.
    mainThreadIdValue = 'chat-T';
    fakeThreadItems = [
      { id: 'chat-T', remoteId: 'chat-T', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1', updatedAt: 2000 } },
    ];
    const { rerender } = renderHook(() => useSessionListRouter());
    switchSpy.mockClear();

    mainThreadIdValue = '__LOCALID_new';
    fakeThreadItems = [
      { id: 'chat-B', remoteId: 'chat-B', status: 'regular', custom: { projectId: 'p1', updatedAt: 2000 } },
    ];
    rerender();

    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith('chat-B');
  });
});

// ---------------------------------------------------------------------------
// Regression (todo #346): a committed draft must retire its return
// target — otherwise a LATER, unrelated archive/discard of the thread the
// draft came from is misread as "still just a deliberate New" and swallowed,
// stranding the user on an empty new-thread picker instead of the fallback.
//
// The clear itself is `new-thread-coordinator.createForLocal`'s job (see its
// own test file) — both the onNew and the aui-native-initialize commit paths
// converge there, so it is the one race-free "this draft just committed"
// signal (a clear placed in this router's own first-send-handoff branch can
// lose that race — aui's native seam can move mainThreadId onto the remote id
// before this branch's own `items`-reload check ever turns true). This test
// covers the router's OWN half of the contract: once the return target is
// gone, a later archive of the thread it used to name must fall back
// normally rather than getting swallowed as "still a deliberate New".
// ---------------------------------------------------------------------------

describe('useSessionListRouter — falls back normally once a committed draft has retired its return target (regression)', () => {
  it('falls back to chat-N when chat-T is archived after its return target was cleared (as createForLocal does on commit)', () => {
    // 1) Active on chat-T.
    mainThreadIdValue = 'chat-T';
    fakeThreadItems = [
      { id: 'chat-T', remoteId: 'chat-T', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: 'chat-N', remoteId: 'chat-N', status: 'regular', custom: { projectId: 'p1', updatedAt: 4000 } },
    ];
    const { rerender } = renderHook(() => useSessionListRouter());
    switchSpy.mockClear();

    // 2) Deliberate New away from chat-T: stamps chat-T as the draft's return target.
    useDraftReturnTarget.getState().setReturnTarget('chat-T');
    mainThreadIdValue = '__LOCALID_new';
    rerender();

    // 3) First send commits the draft (createForLocal clears the return
    // target synchronously as part of that commit, well before the reload
    // this router reacts to ever lands) and the reloaded list carries the
    // remote chat — the router hands off onto it.
    useDraftReturnTarget.getState().clear();
    fakeThreadItems = [
      { id: 'chat-T', remoteId: 'chat-T', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: '__LOCALID_new', remoteId: 'chat-N', status: 'regular' },
      { id: 'chat-N', remoteId: 'chat-N', status: 'regular', custom: { projectId: 'p1', updatedAt: 4000 } },
    ];
    rerender();
    expect(switchSpy).toHaveBeenCalledWith('chat-N');
    switchSpy.mockClear();

    // 4) The handoff switch lands — the user is now really on chat-N — then
    // clicks back to chat-T.
    mainThreadIdValue = 'chat-N';
    rerender();
    mainThreadIdValue = 'chat-T';
    rerender();
    switchSpy.mockClear();

    // 5) chat-T is archived while active — aui bumps to a fresh draft. With a
    // STALE return target this would match chat-T (the just-departed thread)
    // and refuse to redirect, stranding the user on the empty draft instead
    // of falling back to chat-N — but the target was already retired in (3).
    mainThreadIdValue = '__LOCALID_after_archive';
    fakeThreadItems = [
      { id: 'chat-T', remoteId: 'chat-T', status: 'archived', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: 'chat-N', remoteId: 'chat-N', status: 'regular', custom: { projectId: 'p1', updatedAt: 4000 } },
    ];
    rerender();

    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith('chat-N');
  });
});

// ---------------------------------------------------------------------------
// First-send handoff: adopt the created session as the active thread
// ---------------------------------------------------------------------------

describe('useSessionListRouter — first send adopts the created session (todo #210)', () => {
  /** Boot on chat-A, then open a deliberate New draft. Returns the rerender fn. */
  function startOnDraft() {
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
    ];
    const { rerender } = renderHook(() => useSessionListRouter());
    mainThreadIdValue = '__LOCALID_new';
    rerender();
    switchSpy.mockClear();
    return rerender;
  }

  it('switches to the new remote session once the reloaded list carries it', () => {
    const rerender = startOnDraft();

    // First send: initialize stamped remoteId on the draft entry, and the
    // chat.created reload landed the canonical remote row — aui re-keys the
    // list to it, stranding the selection on the custom-less draft.
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: '__LOCALID_new', remoteId: 'chat-new', status: 'regular' },
      { id: 'chat-new', remoteId: 'chat-new', status: 'regular', custom: { projectId: 'p1', updatedAt: 4000 } },
    ];
    rerender();

    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith('chat-new');
  });

  it('does NOT switch while the created chat has not appeared in the list yet', () => {
    const rerender = startOnDraft();

    // remoteId stamped, but the reloaded list does not carry the chat yet.
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: '__LOCALID_new', remoteId: 'chat-new', status: 'regular' },
    ];
    rerender();

    expect(switchSpy).not.toHaveBeenCalled();
  });

  it('does NOT switch for a fresh draft with no remoteId when the list reloads', () => {
    const rerender = startOnDraft();

    // Unrelated reload (e.g. another window created a chat) while composing.
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: '__LOCALID_new', status: 'new' },
      { id: 'chat-other', remoteId: 'chat-other', status: 'regular', custom: { projectId: 'p2', updatedAt: 5000 } },
    ];
    rerender();

    expect(switchSpy).not.toHaveBeenCalled();
  });
});

it('calls disposeSpy exactly once when the hook unmounts', () => {
  const { unmount } = renderHook(() => useSessionListRouter());

  unmount();

  expect(disposeSpy).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Boot auto-select tests (new — one-shot most-recent non-archived session)
// ---------------------------------------------------------------------------

/**
 * Helper: build a fakeThreadItems entry that carries an updatedAt in custom so
 * threadItemsToSessionItems projects it to a full SessionItem with the right
 * updatedAt, which pickInitialSession then ranks.
 */
function bootItem(
  id: string,
  updatedAt: number,
  status: 'regular' | 'archived' = 'regular',
  projectId = 'proj-boot',
): (typeof fakeThreadItems)[number] {
  return { id, remoteId: id, status, custom: { projectId, updatedAt } };
}

it('calls switchSpy once with "chat-newest" (most-recent non-archived) when mainThreadId is a draft', () => {
  mainThreadIdValue = '__LOCALID_abc123';
  fakeThreadItems = [bootItem('chat-oldest', 1000), bootItem('chat-newest', 3000), bootItem('chat-middle', 2000)];

  renderHook(() => useSessionListRouter());

  expect(switchSpy).toHaveBeenCalledTimes(1);
  expect(switchSpy).toHaveBeenCalledWith('chat-newest');
});

it('does NOT call switchSpy for the boot effect while a create is in flight for the draft (todo #346)', () => {
  // The real ordering: a fresh app's first non-empty list load is reliably the
  // reload the new chat's OWN chat.created event triggers, arriving while
  // new-thread-coordinator's create workflow (tuning/worktree PATCHes) is
  // still open for this exact local id — `onNew` never dispatches the
  // optimistic pending message until that workflow fully settles, so a
  // message-count check can never observe this window (the first fix attempt
  // read count 0 here too, and was a no-op). isCreateInFlight observes the
  // coordinator directly instead.
  mainThreadIdValue = '__LOCALID_sending';
  inFlightLocalIds = new Set(['__LOCALID_sending']);
  fakeThreadItems = [bootItem('chat-just-created', 1000)];

  renderHook(() => useSessionListRouter());

  expect(switchSpy).not.toHaveBeenCalled();
});

it('consumes the boot one-shot the moment a create is seen in flight — it never fires later, even once the create settles', () => {
  mainThreadIdValue = '__LOCALID_sending';
  inFlightLocalIds = new Set(['__LOCALID_sending']);
  fakeThreadItems = [bootItem('chat-just-created', 1000)];

  const { rerender } = renderHook(() => useSessionListRouter());
  expect(switchSpy).not.toHaveBeenCalled();

  // The create settles (success or abandon) — the coordinator no longer
  // reports it in flight, and something else about the list changed too (a
  // second chat arrived). The one-shot was already consumed the instant the
  // create was seen in flight, so boot-select must not switch AWAY from the
  // chat the user just created — that would race the other effect's own
  // handoff switchToThread(remoteId), which hasn't yet seen mainThreadId move
  // off the draft in this same render.
  inFlightLocalIds = new Set();
  fakeThreadItems = [bootItem('chat-just-created', 1000), bootItem('chat-second', 2000)];
  rerender();

  expect(switchSpy).not.toHaveBeenCalled();
});

it('calls switchSpy once with "chat-b" when mainThreadId is null and sessions load', () => {
  mainThreadIdValue = null;
  fakeThreadItems = [bootItem('chat-a', 500), bootItem('chat-b', 1500)];

  renderHook(() => useSessionListRouter());

  expect(switchSpy).toHaveBeenCalledTimes(1);
  expect(switchSpy).toHaveBeenCalledWith('chat-b');
});

it('does NOT call switchSpy for the boot effect when mainThreadId is already a real session id', () => {
  // Use a non-archived active session as the current thread so the
  // archived-active fallback effect also stays silent, isolating boot behavior.
  mainThreadIdValue = 'chat-A';
  fakeThreadItems = [bootItem('chat-A', 1000), bootItem('chat-B', 2000)];

  renderHook(() => useSessionListRouter());

  expect(switchSpy).not.toHaveBeenCalled();
});

it('calls switchSpy only once even after the items change a second time (boot auto-select is one-shot)', () => {
  mainThreadIdValue = '__LOCALID_xyz';
  fakeThreadItems = [bootItem('chat-first', 1000)];

  const { rerender } = renderHook(() => useSessionListRouter());

  expect(switchSpy).toHaveBeenCalledTimes(1);
  expect(switchSpy).toHaveBeenCalledWith('chat-first');

  // Simulate a later items update (e.g. daemon reload adds more sessions)
  fakeThreadItems = [bootItem('chat-first', 1000), bootItem('chat-second', 9000)];

  rerender();

  // The one-shot ref is consumed; switchSpy must NOT be called again
  expect(switchSpy).toHaveBeenCalledTimes(1);
});

it('does NOT call switchSpy when the items list is empty at boot', () => {
  mainThreadIdValue = '__LOCALID_empty';
  fakeThreadItems = [];

  renderHook(() => useSessionListRouter());

  expect(switchSpy).not.toHaveBeenCalled();
});

describe('useSessionListRouter — boot restores the last open session', () => {
  it('switches to the persisted session (by remoteId) even when an other session is more recent', () => {
    mainThreadIdValue = '__LOCALID_boot';
    lastSessionIdValue = 'chat-old';
    fakeThreadItems = [bootItem('chat-old', 1000), bootItem('chat-new', 3000)];

    renderHook(() => useSessionListRouter());

    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith('chat-old');
  });

  it('falls back to the most-recent session when the persisted id is gone', () => {
    mainThreadIdValue = '__LOCALID_boot';
    lastSessionIdValue = 'chat-deleted';
    fakeThreadItems = [bootItem('chat-a', 1000), bootItem('chat-b', 2000)];

    renderHook(() => useSessionListRouter());

    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith('chat-b');
  });
});

it('calls setLastSessionId with the active session remoteId when the active thread changes', () => {
  mainThreadIdValue = 'chat-A';
  fakeThreadItems = [{ id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p1', updatedAt: 1000 } }];

  renderHook(() => useSessionListRouter());

  expect(setLastSessionIdSpy).toHaveBeenCalledWith('chat-A');
});

// ---------------------------------------------------------------------------
// onMarkUnread is a no-op for the currently active thread (MED-5)
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

  it('does NOT call markUnreadSpy when the marked id matches the active item remoteId', () => {
    mainThreadIdValue = 'thread-A';
    fakeThreadItems = [{ id: 'thread-A', remoteId: 'chat-A', custom: { projectId: 'p1' } }];

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

// ---------------------------------------------------------------------------
// Split view: a VISIBLE zone counts as viewed, focused or not
// ---------------------------------------------------------------------------

describe('useSessionListRouter — the split suppresses unread for both zones', () => {
  /** chat-A active; thread-B is the other zone, created this run (remote chat-B). */
  function splitOnAandB() {
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', custom: { projectId: 'p1' } },
      { id: 'thread-B', remoteId: 'chat-B', custom: { projectId: 'p1' } },
      { id: 'chat-C', remoteId: 'chat-C', custom: { projectId: 'p1' } },
    ];
  }

  it('does NOT mark the unfocused zone unread', () => {
    splitOnAandB();
    useZonesStore.setState({ zones: ['chat-A', 'thread-B'], focusedIndex: 0 });

    renderHook(() => useSessionListRouter());

    act(() => {
      capturedDeps.onMarkUnread('thread-B');
    });

    expect(markUnreadSpy).not.toHaveBeenCalled();
  });

  it('does NOT mark the unfocused zone unread by its remoteId either', () => {
    splitOnAandB();
    useZonesStore.setState({ zones: ['chat-A', 'thread-B'], focusedIndex: 0 });

    renderHook(() => useSessionListRouter());

    act(() => {
      capturedDeps.onMarkUnread('chat-B');
    });

    expect(markUnreadSpy).not.toHaveBeenCalled();
  });

  it('still marks a chat that is on neither side of the split', () => {
    splitOnAandB();
    useZonesStore.setState({ zones: ['chat-A', 'thread-B'], focusedIndex: 0 });

    renderHook(() => useSessionListRouter());

    act(() => {
      capturedDeps.onMarkUnread('chat-C');
    });

    expect(markUnreadSpy).toHaveBeenCalledTimes(1);
    expect(markUnreadSpy).toHaveBeenCalledWith('chat-C');
  });

  it('marks the second chat again once the split closes', () => {
    splitOnAandB();
    useZonesStore.setState({ zones: ['chat-A', 'thread-B'], focusedIndex: 0 });
    renderHook(() => useSessionListRouter());

    act(() => {
      useZonesStore.getState().closeSplit();
    });
    act(() => {
      capturedDeps.onMarkUnread('thread-B');
    });

    expect(markUnreadSpy).toHaveBeenCalledTimes(1);
    expect(markUnreadSpy).toHaveBeenCalledWith('thread-B');
  });

  it('clears the dot of a chat that joins the split under both of its ids', () => {
    splitOnAandB();
    renderHook(() => useSessionListRouter());
    clearUnreadSpy.mockClear();

    act(() => {
      useZonesStore.getState().openSplit('chat-A', 'thread-B');
    });

    expect(clearUnreadSpy).toHaveBeenCalledWith('chat-A');
    expect(clearUnreadSpy).toHaveBeenCalledWith('thread-B');
    expect(clearUnreadSpy).toHaveBeenCalledWith('chat-B');
  });
});

// ---------------------------------------------------------------------------
// Active thread change wires the per-session workspace layout store
// ---------------------------------------------------------------------------

describe('useSessionListRouter — active thread change wires per-session layout', () => {
  it('restores a previously customized layout when switching back to a visited session', () => {
    // Prime chat-old's persisted workspace with a non-default layout (files split in).
    useLayoutStore.getState().setActiveSession('chat-old');
    useLayoutStore.getState().toggleSurface('workspace');
    expect(useLayoutStore.getState().layout.top).toContain('workspace');

    // Switch away, as if the user opened a different session.
    useLayoutStore.getState().setActiveSession('chat-other');
    expect(useLayoutStore.getState().layout.top).not.toContain('workspace');

    // Now render the hook as if the app activated chat-old again — the hook's
    // wiring (not a direct store call) must restore chat-old's saved layout.
    mainThreadIdValue = 'chat-old';
    fakeThreadItems = [{ id: 'chat-old', remoteId: 'chat-old', custom: { projectId: 'p1', updatedAt: 1000 } }];

    renderHook(() => useSessionListRouter());

    expect(useLayoutStore.getState().activeSessionId).toBe('chat-old');
    expect(useLayoutStore.getState().layout.top).toContain('workspace');
  });

  it('seeds a never-visited session with the default (INITIAL_LAYOUT) workspace', () => {
    mainThreadIdValue = 'chat-brand-new';
    fakeThreadItems = [
      { id: 'chat-brand-new', remoteId: 'chat-brand-new', custom: { projectId: 'p1', updatedAt: 1000 } },
    ];

    renderHook(() => useSessionListRouter());

    expect(useLayoutStore.getState().activeSessionId).toBe('chat-brand-new');
    expect(useLayoutStore.getState().layout.top).toEqual(['chat']);
    expect(useLayoutStore.getState().layout.bottom).toBeNull();
  });

  it("activating a __LOCALID_* draft makes it the layout store's active session with a chat-only arrangement", () => {
    useLayoutStore.getState().setActiveSession('chat-prior');
    useLayoutStore.getState().toggleSurface('workspace');

    mainThreadIdValue = '__LOCALID_new';
    fakeThreadItems = [];

    renderHook(() => useSessionListRouter());

    expect(useLayoutStore.getState().activeSessionId).toBe('__LOCALID_new');
    expect(useLayoutStore.getState().layout.top).toEqual(['chat']);
    expect(useLayoutStore.getState().layout.bottom).toBeNull();
  });

  it("a workspace toggle made while on the draft leaves the previously active chat's remembered entry untouched, and restores it on return", () => {
    mainThreadIdValue = 'chat-prior';
    fakeThreadItems = [{ id: 'chat-prior', remoteId: 'chat-prior', custom: { projectId: 'p1', updatedAt: 1000 } }];
    const { rerender } = renderHook(() => useSessionListRouter());
    expect(useLayoutStore.getState().activeSessionId).toBe('chat-prior');

    mainThreadIdValue = '__LOCALID_new';
    rerender();
    useLayoutStore.getState().toggleSurface('workspace'); // opened only on the draft

    mainThreadIdValue = 'chat-prior';
    rerender();

    expect(useLayoutStore.getState().activeSessionId).toBe('chat-prior');
    expect(useLayoutStore.getState().layout.top).not.toContain('workspace');
  });

  it("adopts the draft's layout entry onto the remote id on the first-send handoff", () => {
    mainThreadIdValue = 'chat-A';
    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
    ];
    const { rerender } = renderHook(() => useSessionListRouter());

    mainThreadIdValue = '__LOCALID_new';
    rerender();
    useLayoutStore.getState().toggleSurface('workspace'); // composed with the workspace open

    fakeThreadItems = [
      { id: 'chat-A', remoteId: 'chat-A', status: 'regular', custom: { projectId: 'p1', updatedAt: 3000 } },
      { id: '__LOCALID_new', remoteId: 'chat-new', status: 'regular' },
      { id: 'chat-new', remoteId: 'chat-new', status: 'regular', custom: { projectId: 'p1', updatedAt: 4000 } },
    ];
    rerender();

    expect(switchSpy).toHaveBeenCalledWith('chat-new');
    expect(useLayoutStore.getState().sessions.has('__LOCALID_new')).toBe(false);
    expect(useLayoutStore.getState().sessions.get('chat-new')?.layout.top).toContain('workspace');
  });

  it('does not write lastSessionId or lastForProject while on a draft', () => {
    mainThreadIdValue = '__LOCALID_new';
    fakeThreadItems = [];

    renderHook(() => useSessionListRouter());

    expect(setLastSessionIdSpy).not.toHaveBeenCalled();
    expect(setLastForProjectSpy).not.toHaveBeenCalled();
  });
});
