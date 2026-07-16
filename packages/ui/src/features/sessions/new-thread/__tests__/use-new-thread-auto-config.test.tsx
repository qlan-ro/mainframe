/**
 * useNewThreadAutoConfig — behavior tests.
 *
 * Strategy:
 *  - Mock @assistant-ui/react → useAuiState driven via fakeAuiState.
 *  - Mock @/store/session-filters → useSessionFilters driven via fakeFilters.
 *  - Mock @/store/settings → useSettingsStore driven via fakeDefaultAdapterId.
 *  - Mock @/store/adapters → useAdapters driven via fakeAdapters.
 *  - Mock ../runtime/draft-config → spy on setDraftConfig, stub getDraftConfig.
 *  - Use the REAL new-thread-ready-store (zustand) and reset it between tests.
 *    markReady is checked via store state (readyIds.has), not a spy.
 *    setDraftConfig and setDraftConfig are the observable side-effects asserted.
 *
 * Behaviors covered:
 *  1. New local thread + filterProjectId set → setDraftConfig with the right config
 *     and the store's readyIds gains the localId.
 *  2. filterProjectId is null → setDraftConfig not called.
 *  3. Thread is already ready → setDraftConfig not called.
 *  4. Draft already exists for localId → setDraftConfig not called (no overwrite).
 *  5. Not a __LOCALID_* id → setDraftConfig not called.
 *  6. itemStatus !== 'new' → setDraftConfig not called.
 *  7. Messages already present (messageCount > 0) → setDraftConfig not called.
 *  8. Regression (bug: draft discard is a no-op with a pill active): a local id
 *     just marked "discarded" (useDiscardedDraftStore) must NOT be re-armed even
 *     though it still looks like a fresh, unconfigured __LOCALID_* thread.
 *  9. general.defaultAdapterId is set → setDraftConfig uses it instead of 'claude'.
 * 10. defaultAdapterId is unset but an installed adapter exists → uses the first
 *     installed adapter's id.
 * 11. defaultAdapterId is unset and nothing is installed → falls back to 'claude'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Controlled fakes — mutated per test before the hook reads them
// ---------------------------------------------------------------------------

interface FakeAuiState {
  threadListItem: { id: string | null; status: string | undefined } | null;
  thread: { messages: { id: string }[] };
}

let fakeAuiState: FakeAuiState = {
  threadListItem: null,
  thread: { messages: [] },
};

let fakeFilterProjectId: string | null = null;
let fakeDefaultAdapterId: string | null = null;
let fakeAdapters: { id: string; installed: boolean }[] = [];

const setDraftConfigSpy = vi.fn();
let getDraftConfigResult: unknown = undefined;
let initializationGate: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: FakeAuiState) => unknown) => selector(fakeAuiState),
}));

vi.mock('@/store/session-filters', () => ({
  useSessionFilters: (selector: (s: { filterProjectId: string | null }) => unknown) =>
    selector({ filterProjectId: fakeFilterProjectId }),
}));

vi.mock('@/store/settings', () => ({
  useSettingsStore: (selector: (s: { general: { defaultAdapterId: string | null } }) => unknown) =>
    selector({ general: { defaultAdapterId: fakeDefaultAdapterId } }),
}));

vi.mock('@/store/adapters', () => ({
  useAdapters: () => fakeAdapters,
}));

vi.mock('../../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

vi.mock('../../runtime/draft-config', () => ({
  setDraftConfig: (...args: unknown[]) => setDraftConfigSpy(...args),
  getDraftConfig: (_id: string) => getDraftConfigResult,
}));

vi.mock('../initialize-draft', () => ({
  initializeDraft: async (args: {
    localId: string;
    projectId: string;
    defaultAdapterId: string | null;
    adapters: { id: string; installed: boolean }[];
  }) => {
    if (initializationGate) await initializationGate;
    const adapterId = args.defaultAdapterId ?? args.adapters.find((adapter) => adapter.installed)?.id ?? 'claude';
    setDraftConfigSpy(args.localId, { projectId: args.projectId, adapterId });
    useNewThreadReady.getState().markReady(args.localId);
    return { projectId: args.projectId, adapterId };
  },
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks — use the REAL ready store so getState().markReady works
// ---------------------------------------------------------------------------

import { useNewThreadReady } from '../../runtime/new-thread-ready-store';
import { useDiscardedDraftStore, markDraftDiscarded } from '../discarded-drafts';
const { useNewThreadAutoConfig } = await import('../use-new-thread-auto-config');

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setDraftConfigSpy.mockReset();
  getDraftConfigResult = undefined;
  initializationGate = null;
  fakeFilterProjectId = null;
  fakeDefaultAdapterId = null;
  fakeAdapters = [];
  fakeAuiState = {
    threadListItem: null,
    thread: { messages: [] },
  };
  // Reset the real ready store.
  useNewThreadReady.setState({ readyIds: new Set<string>() });
  useDiscardedDraftStore.setState({ ids: new Set<string>() });
});

// ---------------------------------------------------------------------------
// Helper: configure a fresh local thread with a project filter
// ---------------------------------------------------------------------------
function setLocalThreadWithProject(localId = '__LOCALID_x', projectId = 'proj-42') {
  fakeAuiState = {
    threadListItem: { id: localId, status: 'new' },
    thread: { messages: [] },
  };
  fakeFilterProjectId = projectId;
}

// ---------------------------------------------------------------------------
// 1. New local thread + filterProjectId set → setDraftConfig + markReady
// ---------------------------------------------------------------------------

describe('useNewThreadAutoConfig — project filter active on new local thread', () => {
  it('calls setDraftConfig with {projectId, adapterId:"claude"} and no permissionMode (daemon applies defaultMode)', async () => {
    setLocalThreadWithProject('__LOCALID_x', 'proj-42');

    await act(async () => {
      renderHook(() => useNewThreadAutoConfig());
    });

    expect(setDraftConfigSpy).toHaveBeenCalledExactlyOnceWith('__LOCALID_x', {
      projectId: 'proj-42',
      adapterId: 'claude',
    });
  });

  it('marks the local id ready in the store', async () => {
    setLocalThreadWithProject('__LOCALID_x', 'proj-42');

    await act(async () => {
      renderHook(() => useNewThreadAutoConfig());
    });

    expect(useNewThreadReady.getState().readyIds.has('__LOCALID_x')).toBe(true);
  });

  it('does not mark the local id ready before asynchronous initialization resolves', async () => {
    let release!: () => void;
    initializationGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setLocalThreadWithProject('__LOCALID_x', 'proj-42');

    renderHook(() => useNewThreadAutoConfig());
    expect(useNewThreadReady.getState().isReady('__LOCALID_x')).toBe(false);

    await act(async () => release());
    expect(useNewThreadReady.getState().isReady('__LOCALID_x')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. filterProjectId is null → neither called
// ---------------------------------------------------------------------------

describe('useNewThreadAutoConfig — no project filter (All view)', () => {
  it('does not call setDraftConfig and does not mark ready when filterProjectId is null', () => {
    fakeAuiState = {
      threadListItem: { id: '__LOCALID_x', status: 'new' },
      thread: { messages: [] },
    };
    fakeFilterProjectId = null;

    renderHook(() => useNewThreadAutoConfig());

    expect(setDraftConfigSpy).not.toHaveBeenCalled();
    expect(useNewThreadReady.getState().readyIds.has('__LOCALID_x')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Thread already ready → neither called
// ---------------------------------------------------------------------------

describe('useNewThreadAutoConfig — thread already marked ready', () => {
  it('does not call setDraftConfig when the thread is already ready', () => {
    setLocalThreadWithProject('__LOCALID_x', 'proj-42');
    useNewThreadReady.getState().markReady('__LOCALID_x');

    renderHook(() => useNewThreadAutoConfig());

    expect(setDraftConfigSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Draft already exists → neither called (no overwrite)
// ---------------------------------------------------------------------------

describe('useNewThreadAutoConfig — draft already exists', () => {
  it('does not overwrite an existing draft and does not mark ready', () => {
    setLocalThreadWithProject('__LOCALID_x', 'proj-42');
    getDraftConfigResult = { projectId: 'proj-old', adapterId: 'claude', permissionMode: 'default' };

    renderHook(() => useNewThreadAutoConfig());

    expect(setDraftConfigSpy).not.toHaveBeenCalled();
    expect(useNewThreadReady.getState().readyIds.has('__LOCALID_x')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Not a __LOCALID_* id → neither called
// ---------------------------------------------------------------------------

describe('useNewThreadAutoConfig — non-local thread id', () => {
  it('does not call setDraftConfig for a regular chat id', () => {
    fakeAuiState = {
      threadListItem: { id: 'chat-server-123', status: 'regular' },
      thread: { messages: [] },
    };
    fakeFilterProjectId = 'proj-42';

    renderHook(() => useNewThreadAutoConfig());

    expect(setDraftConfigSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. itemStatus !== 'new' → neither called
// ---------------------------------------------------------------------------

describe('useNewThreadAutoConfig — thread status is not "new"', () => {
  it('does not call setDraftConfig when status is "regular"', () => {
    fakeAuiState = {
      threadListItem: { id: '__LOCALID_x', status: 'regular' },
      thread: { messages: [] },
    };
    fakeFilterProjectId = 'proj-42';

    renderHook(() => useNewThreadAutoConfig());

    expect(setDraftConfigSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. Messages already present → neither called
// ---------------------------------------------------------------------------

describe('useNewThreadAutoConfig — thread already has messages', () => {
  it('does not call setDraftConfig when the thread has messages', () => {
    fakeAuiState = {
      threadListItem: { id: '__LOCALID_x', status: 'new' },
      thread: { messages: [{ id: 'm1' }] },
    };
    fakeFilterProjectId = 'proj-42';

    renderHook(() => useNewThreadAutoConfig());

    expect(setDraftConfigSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. Regression: a just-discarded local id must not be instantly re-armed.
//
// Bug: onDiscard resets the draft config + ready flag for the reused
// __LOCALID_* slot, then asynchronously switches away — but switchToThread
// hasn't landed yet, so this hook still sees the SAME slot as the active,
// fresh, unconfigured thread and immediately re-seeds the very draft the user
// just closed. Only reproducible with a project pill active — in "All" view
// filterProjectId is null and this hook is already a no-op (case 2 above).
// ---------------------------------------------------------------------------

describe('useNewThreadAutoConfig — a just-discarded local id is not re-armed', () => {
  it('does not call setDraftConfig for a local id marked discarded, even though it still looks fresh', () => {
    setLocalThreadWithProject('__LOCALID_x', 'proj-42');
    markDraftDiscarded('__LOCALID_x');

    renderHook(() => useNewThreadAutoConfig());

    expect(setDraftConfigSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9-11. defaultAdapterId resolution: setting → first installed adapter → 'claude'.
// ---------------------------------------------------------------------------

describe('useNewThreadAutoConfig — adapterId resolution', () => {
  it('uses general.defaultAdapterId when it is set', () => {
    setLocalThreadWithProject('__LOCALID_x', 'proj-42');
    fakeDefaultAdapterId = 'gemini';
    fakeAdapters = [{ id: 'claude', installed: true }];

    renderHook(() => useNewThreadAutoConfig());

    expect(setDraftConfigSpy).toHaveBeenCalledExactlyOnceWith('__LOCALID_x', {
      projectId: 'proj-42',
      adapterId: 'gemini',
    });
  });

  it('falls back to the first installed adapter when defaultAdapterId is unset', () => {
    setLocalThreadWithProject('__LOCALID_x', 'proj-42');
    fakeDefaultAdapterId = null;
    fakeAdapters = [
      { id: 'codex', installed: false },
      { id: 'gemini', installed: true },
    ];

    renderHook(() => useNewThreadAutoConfig());

    expect(setDraftConfigSpy).toHaveBeenCalledExactlyOnceWith('__LOCALID_x', {
      projectId: 'proj-42',
      adapterId: 'gemini',
    });
  });

  it('falls back to "claude" when defaultAdapterId is unset and nothing is installed', () => {
    setLocalThreadWithProject('__LOCALID_x', 'proj-42');
    fakeDefaultAdapterId = null;
    fakeAdapters = [{ id: 'codex', installed: false }];

    renderHook(() => useNewThreadAutoConfig());

    expect(setDraftConfigSpy).toHaveBeenCalledExactlyOnceWith('__LOCALID_x', {
      projectId: 'proj-42',
      adapterId: 'claude',
    });
  });
});
