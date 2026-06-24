/**
 * useNewThreadAutoConfig — behavior tests.
 *
 * Strategy:
 *  - Mock @assistant-ui/react → useAuiState driven via fakeAuiState.
 *  - Mock @/store/session-filters → useSessionFilters driven via fakeFilters.
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

const setDraftConfigSpy = vi.fn();
let getDraftConfigResult: unknown = undefined;

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

vi.mock('../../runtime/draft-config', () => ({
  setDraftConfig: (...args: unknown[]) => setDraftConfigSpy(...args),
  getDraftConfig: (_id: string) => getDraftConfigResult,
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks — use the REAL ready store so getState().markReady works
// ---------------------------------------------------------------------------

import { useNewThreadReady } from '../../runtime/new-thread-ready-store';
const { useNewThreadAutoConfig } = await import('../use-new-thread-auto-config');

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setDraftConfigSpy.mockReset();
  getDraftConfigResult = undefined;
  fakeFilterProjectId = null;
  fakeAuiState = {
    threadListItem: null,
    thread: { messages: [] },
  };
  // Reset the real ready store.
  useNewThreadReady.setState({ readyIds: new Set<string>() });
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
