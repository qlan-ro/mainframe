/**
 * useStartNewSession — the stalled-fetch double-trigger race (todo #365).
 *
 * Reproduces the reported bug: a second New-session trigger arriving while
 * the first draft is still initializing (the provider-settings fetch has not
 * resolved, so the draft reports no project) must not land the draft on the
 * choose-a-project welcome. Runs the REAL useStartNewSession, openNewThreadDraft,
 * initializeDraft, resetNewThreadDraft and stores — only the daemon call
 * (getProviderSettings) and the aui `threads` scope are faked, plus a thin
 * hand-wired stand-in for useOpenNewThreadDraft that calls the real
 * openNewThreadDraft with test-controlled deps (rather than pulling the
 * production hook's daemon-port/settings/adapters stores). This is why the
 * mocks differ from the wiring-only use-start-new-session.test.tsx and the
 * suite lives in its own file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

const DRAFT_ID = '__LOCALID_1';
const SOURCE_THREAD_ID = 'chat-7';
const SOURCE_PROJECT_ID = 'proj-source';

// ---------------------------------------------------------------------------
// A stateful aui `threads` double supporting both starting states the brief
// requires: a boot draft already occupying the slot, and an empty slot whose
// newThreadId lags switchToNewThread by one macrotask (#359's model).
// ---------------------------------------------------------------------------
interface ThreadsDouble {
  getState: () => { mainThreadId: string | null; newThreadId: string | null };
  switchToNewThread: () => void | Promise<void>;
}

function createThreadsDouble(kind: 'boot' | 'empty'): ThreadsDouble {
  let mainThreadId: string | null = SOURCE_THREAD_ID;
  let settled = kind === 'boot';

  return {
    getState: () => ({ mainThreadId, newThreadId: settled ? DRAFT_ID : kind === 'boot' ? DRAFT_ID : null }),
    switchToNewThread: () => {
      mainThreadId = DRAFT_ID;
      if (kind === 'boot') {
        settled = true;
        return;
      }
      // Empty slot: switchToNewThread's own await resolves fast, but the slot
      // stays unobservable (newThreadId null) until a later macrotask.
      return Promise.resolve().then(() => {
        setTimeout(() => {
          settled = true;
        }, 0);
      });
    },
  };
}

let currentDouble: ThreadsDouble = createThreadsDouble('boot');
let filterProjectIds: Set<string> = new Set();
let sourceProjectId: string | null = SOURCE_PROJECT_ID;

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({ threads: currentDouble }),
}));

vi.mock('@/store/session-filters', () => ({
  useSessionFilters: (sel: (s: { filterProjectIds: Set<string> }) => unknown) => sel({ filterProjectIds }),
  soleProjectId: (ids: ReadonlySet<string>) => (ids.size === 1 ? [...ids][0]! : null),
}));

vi.mock('../../use-active-identity', () => ({
  useActiveIdentity: () => {
    const { mainThreadId } = currentDouble.getState();
    if (mainThreadId === SOURCE_THREAD_ID) return { projectId: sourceProjectId ?? undefined };
    return { projectId: getDraftConfig(mainThreadId ?? '')?.projectId };
  },
}));

const abandonCreateForLocal = vi.fn();
vi.mock('../../runtime/new-thread-coordinator', () => ({
  abandonCreateForLocal: (...args: unknown[]) => abandonCreateForLocal(...args),
}));

const getProviderSettings = vi.fn();
vi.mock('@/lib/api/settings', () => ({ getProviderSettings: (...args: unknown[]) => getProviderSettings(...args) }));

const setText = vi.fn();
const mfToastError = vi.fn();
const clearProjectFilter = vi.fn();

// A hand-wired stand-in for useOpenNewThreadDraft: same real openNewThreadDraft
// + real resetNewThreadDraft/initializeDraft, deps read fresh like production,
// but skipping the daemon-port/settings/adapters store plumbing the real hook
// pulls in.
vi.mock('../use-open-new-thread-draft', () => ({
  useOpenNewThreadDraft: () => (args: { projectId: string; adapterId?: string }) =>
    realOpenNewThreadDraft(args, {
      filterProjectIds,
      clearProjectFilter,
      runtimeThreads: currentDouble,
      setReturnTarget: (id: string | null) => realUseDraftReturnTarget.getState().setReturnTarget(id),
      resetNewThreadDraft: realResetNewThreadDraft,
      initializeDraft: ({
        localId,
        projectId,
        adapterId,
      }: {
        localId: string;
        projectId: string;
        adapterId?: string;
      }) =>
        realInitializeDraft({
          localId,
          projectId,
          port: 31415,
          defaultAdapterId: null,
          adapters: TEST_ADAPTERS,
          adapterId,
        }),
      setText,
      mfToastError,
    }),
}));

import { getDraftConfig, useDraftConfigStore } from '../../runtime/draft-config';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';
import { usePendingDraftProject } from '../pending-draft-project';
import { useDraftReturnTarget as realUseDraftReturnTarget } from '../use-draft-return-target';
import { resetNewThreadDraft as realResetNewThreadDraft } from '../reset-new-thread-draft';
import { initializeDraft as realInitializeDraft } from '../initialize-draft';
import { openNewThreadDraft as realOpenNewThreadDraft } from '../open-new-thread-draft';
import { useStartNewSession } from '../use-start-new-session';

const TEST_ADAPTERS: AdapterInfo[] = [
  {
    id: 'claude',
    name: 'Claude',
    description: 'Claude Code',
    installed: true,
    models: [{ id: 'sonnet', label: 'Sonnet', isDefault: true, supportedEfforts: ['low', 'medium'] }],
    capabilities: { planMode: true },
  },
];

/** Waits for the empty-slot double's newThreadId to become observable (the
 *  same macrotask gap #359's `waitForSwitchedDraft` bridges). `vi.waitFor`
 *  only stops retrying once the callback does NOT throw — a bare boolean
 *  return is not enough. */
async function waitForSlotSettled(): Promise<void> {
  await vi.waitFor(() => {
    if (currentDouble.getState().newThreadId == null) throw new Error('slot not settled yet');
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Mirrors ChatSurface's isInitializing gate for the active draft. */
function isInitializingLikeChatSurface(): boolean {
  const { mainThreadId, newThreadId } = currentDouble.getState();
  const activeId = mainThreadId ?? newThreadId;
  if (activeId == null) return false;
  const initialization = useNewThreadReady.getState().getInitialization(activeId);
  const draftCfg = getDraftConfig(activeId);
  const pendingProjectId = usePendingDraftProject.getState().projectId;
  const isReady = useNewThreadReady.getState().readyIds.has(activeId);
  return (
    initialization.status === 'initializing' ||
    (initialization.status === 'idle' && pendingProjectId != null && draftCfg == null && !isReady)
  );
}

beforeEach(() => {
  filterProjectIds = new Set();
  sourceProjectId = SOURCE_PROJECT_ID;
  currentDouble = createThreadsDouble('boot');
  getProviderSettings.mockReset();
  abandonCreateForLocal.mockReset();
  setText.mockReset();
  mfToastError.mockReset();
  clearProjectFilter.mockReset();
  useDraftConfigStore.setState({ drafts: new Map() });
  useNewThreadReady.setState({ readyIds: new Set(), initializations: new Map() });
  usePendingDraftProject.setState({ projectId: null, token: 0 });
  realUseDraftReturnTarget.setState({ returnThreadId: null });
});

describe.each([
  ['a boot draft already occupying the slot', 'boot'],
  ['an empty slot right after a committed chat', 'empty'],
] as const)('double New-session trigger with a stalled provider-settings fetch — %s', (_label, kind) => {
  beforeEach(() => {
    currentDouble = createThreadsDouble(kind);
  });

  it('ends scoped to the originating project (active session, no pill) and never shows the choose-a-project welcome in between', async () => {
    const request = deferred<Record<string, unknown>>();
    getProviderSettings.mockReturnValue(request.promise);

    const { result, rerender } = renderHook(() => useStartNewSession());

    act(() => result.current());
    if (kind === 'empty') await act(async () => waitForSlotSettled());
    rerender();
    expect(isInitializingLikeChatSurface()).toBe(true);

    // Second trigger, still before the fetch resolves.
    act(() => result.current());
    rerender();
    expect(isInitializingLikeChatSurface()).toBe(true);

    request.resolve({ claude: { defaultMode: 'acceptEdits' } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getDraftConfig(DRAFT_ID)?.projectId).toBe(SOURCE_PROJECT_ID);
    expect(useNewThreadReady.getState().isReady(DRAFT_ID)).toBe(true);
    expect(realUseDraftReturnTarget.getState().returnThreadId).toBe(SOURCE_THREAD_ID);
  });

  it('with a sole pill, ends scoped to the pill project', async () => {
    filterProjectIds = new Set(['proj-pill']);
    const request = deferred<Record<string, unknown>>();
    getProviderSettings.mockReturnValue(request.promise);

    const { result, rerender } = renderHook(() => useStartNewSession());

    act(() => result.current());
    if (kind === 'empty') await act(async () => waitForSlotSettled());
    rerender();
    act(() => result.current());
    rerender();

    request.resolve({ claude: { defaultMode: 'acceptEdits' } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getDraftConfig(DRAFT_ID)?.projectId).toBe('proj-pill');
    expect(useNewThreadReady.getState().isReady(DRAFT_ID)).toBe(true);
  });

  it('with no pill and no active project, ends unscoped with no initialization (unchanged)', async () => {
    filterProjectIds = new Set();
    sourceProjectId = null;

    const { result } = renderHook(() => useStartNewSession());

    act(() => result.current());
    if (kind === 'empty') await act(async () => waitForSlotSettled());
    act(() => result.current());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getProviderSettings).not.toHaveBeenCalled();
    expect(getDraftConfig(DRAFT_ID)).toBeUndefined();
    expect(useNewThreadReady.getState().getInitialization(DRAFT_ID).status).toBe('idle');
    expect(realUseDraftReturnTarget.getState().returnThreadId).toBe(SOURCE_THREAD_ID);
  });
});
