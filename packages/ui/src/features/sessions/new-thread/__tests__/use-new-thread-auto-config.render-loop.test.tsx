/**
 * useNewThreadAutoConfig — render-loop regression (React error #185).
 *
 * Uses the REAL @/store/adapters store (seeded via seedAdapters), not a mock —
 * unlike the sibling suite (use-new-thread-auto-config.test.tsx), this test is
 * anchored to the shipping useAdapters() implementation so it stays honest
 * about the actual bug: an unmemoized `Object.values(byId)` handed this
 * hook's effect a fresh array (and therefore a "changed" dependency) on every
 * render, even when the catalog never changed. Everything else the hook
 * touches (aui state, session filters, settings, daemon port, draft-config,
 * initializeDraft) stays mocked, matching the sibling suite's harness.
 *
 * Behavior covered:
 *  1. A fresh __LOCALID_* draft with a project filter active and
 *     initializeDraft in flight: two re-renders that change nothing about
 *     localId/filterProjectId/the adapter catalog must not restart
 *     initialization (initializeDraft is called exactly once).
 *  2. The same scenario must not rewrite the useNewThreadReady store (state
 *     identity unchanged across the re-renders).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { DraftCfg } from '../../runtime/draft-config';

interface FakeAuiState {
  threadListItem: { id: string | null; status: string | undefined } | null;
  thread: { messages: { id: string }[] };
}

let fakeAuiState: FakeAuiState = {
  threadListItem: { id: '__LOCALID_x', status: 'new' },
  thread: { messages: [] },
};
let fakeFilterProjectId: string | null = 'proj-42';

const initializeDraftSpy = vi.fn();
let getDraftConfigResult: unknown = undefined;
let initializationGate: Promise<void> | null = null;

const completeSnapshot = (projectId: string, adapterId: string) => ({
  projectId,
  adapterId,
  model: 'default-model',
  permissionMode: 'default',
  planMode: false,
  effort: 'medium',
  fast: false,
  ultracode: false,
  adaptiveThinking: false,
});

// ---------------------------------------------------------------------------
// Mocks — everything EXCEPT @/store/adapters, which is the real store.
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
    selector({ general: { defaultAdapterId: null } }),
}));

vi.mock('../../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

vi.mock('../../runtime/draft-config', () => ({
  setDraftConfig: () => undefined,
  getDraftConfig: (_id: string) => getDraftConfigResult,
}));

vi.mock('../initialize-draft', () => ({
  initializeDraft: async (args: {
    localId: string;
    projectId: string;
    defaultAdapterId: string | null;
    adapters: { id: string; installed: boolean }[];
  }) => {
    initializeDraftSpy(args.localId);
    const adapterId = args.defaultAdapterId ?? args.adapters.find((adapter) => adapter.installed)?.id ?? 'claude';
    const snapshot = completeSnapshot(args.projectId, adapterId);
    // Mirrors the real initializeDraft's synchronous begin-then-await shape so
    // the effect cleanup (cancelInitialization) has a real in-flight attempt
    // to cancel, same as production.
    const attempt = useNewThreadReady
      .getState()
      .beginInitialization(args.localId, () => Promise.resolve(snapshot as unknown as DraftCfg));
    if (initializationGate) await initializationGate;
    const stillCurrent = useNewThreadReady.getState().getInitialization(args.localId).attempt === attempt;
    if (!stillCurrent) return snapshot;
    useNewThreadReady.getState().completeInitialization(args.localId, attempt);
    useNewThreadReady.getState().markReady(args.localId);
    return snapshot;
  },
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks — @/store/adapters and the ready store are REAL.
// ---------------------------------------------------------------------------

import { seedAdapters, resetAdapters } from '@/store/adapters';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';
const { useNewThreadAutoConfig } = await import('../use-new-thread-auto-config');

beforeEach(() => {
  initializeDraftSpy.mockReset();
  getDraftConfigResult = undefined;
  initializationGate = null;
  fakeFilterProjectId = 'proj-42';
  fakeAuiState = { threadListItem: { id: '__LOCALID_x', status: 'new' }, thread: { messages: [] } };
  resetAdapters();
  seedAdapters([
    {
      id: 'claude',
      name: 'claude',
      description: '',
      installed: true,
      models: [],
      modelsRevision: 1,
      catalogSource: 'fallback',
      capabilities: { planMode: true },
    },
  ]);
  useNewThreadReady.setState({ readyIds: new Set(), initializations: new Map() });
});

describe('useNewThreadAutoConfig — render-loop regression (real useAdapters)', () => {
  it('does not restart initialization on re-renders with no actual change', async () => {
    let release!: () => void;
    initializationGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { rerender, unmount } = renderHook(() => useNewThreadAutoConfig());
    rerender();
    rerender();

    expect(initializeDraftSpy).toHaveBeenCalledTimes(1);

    await act(async () => release());
    unmount();
  });

  it('does not rewrite the useNewThreadReady store on re-renders with no actual change', async () => {
    let release!: () => void;
    initializationGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { rerender, unmount } = renderHook(() => useNewThreadAutoConfig());
    const stateAfterMount = useNewThreadReady.getState();
    rerender();
    rerender();

    expect(useNewThreadReady.getState()).toBe(stateAfterMount);

    await act(async () => release());
    unmount();
  });
});
