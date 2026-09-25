/**
 * useStartNewSession — behavior tests.
 *
 * The resolver (resolve-new-session-project.test.ts) and openNewThreadDraft
 * (open-new-thread-draft.test.ts) have their own suites; this hook is tested
 * as pure wiring — which dependency it calls, with what, and the
 * pending-target lifetime around the sequence it delegates to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let __filterProjectIds: Set<string> = new Set();
let __activeProjectId: string | undefined;
let __newThreadId: string | null = '__LOCALID_1';
let __mainThreadId: string | null = 'chat-7';

const switchToNewThread = vi.fn();
const resetNewThreadDraft = vi.fn();
const openNewThreadDraft = vi.fn(async (_args: { projectId: string }) => undefined);

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({
    threads: {
      getState: () => ({ newThreadId: __newThreadId, mainThreadId: __mainThreadId }),
      switchToNewThread,
    },
  }),
}));
vi.mock('@/store/session-filters', () => ({
  useSessionFilters: (sel: (s: { filterProjectIds: Set<string> }) => unknown) =>
    sel({ filterProjectIds: __filterProjectIds }),
  soleProjectId: (ids: ReadonlySet<string>) => (ids.size === 1 ? [...ids][0]! : null),
}));
vi.mock('../../use-active-identity', () => ({ useActiveIdentity: () => ({ projectId: __activeProjectId }) }));
vi.mock('../reset-new-thread-draft', () => ({
  resetNewThreadDraft: (id: string | null | undefined) => resetNewThreadDraft(id),
}));
vi.mock('../use-open-new-thread-draft', () => ({
  useOpenNewThreadDraft: () => (args: { projectId: string }) => openNewThreadDraft(args),
}));

import { useDraftReturnTarget } from '../use-draft-return-target';
import { usePendingDraftProject } from '../pending-draft-project';
import { useStartNewSession } from '../use-start-new-session';

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  __filterProjectIds = new Set();
  __activeProjectId = undefined;
  __newThreadId = '__LOCALID_1';
  __mainThreadId = 'chat-7';
  switchToNewThread.mockReset();
  resetNewThreadDraft.mockReset();
  openNewThreadDraft.mockReset();
  openNewThreadDraft.mockImplementation(async () => undefined);
  useDraftReturnTarget.setState({ returnThreadId: null });
  usePendingDraftProject.setState({ projectId: null });
});

describe('useStartNewSession — target resolution', () => {
  it('the pill wins over the active session', async () => {
    __filterProjectIds = new Set(['proj-pill']);
    __activeProjectId = 'proj-active';

    const { result } = renderHook(() => useStartNewSession());
    await act(async () => {
      result.current();
      await flush();
    });

    expect(openNewThreadDraft).toHaveBeenCalledExactlyOnceWith({ projectId: 'proj-pill' });
  });

  it("with no pill, inherits the active session's project", async () => {
    __filterProjectIds = new Set();
    __activeProjectId = 'proj-active';

    const { result } = renderHook(() => useStartNewSession());
    await act(async () => {
      result.current();
      await flush();
    });

    expect(openNewThreadDraft).toHaveBeenCalledExactlyOnceWith({ projectId: 'proj-active' });
  });

  it('a projectless active draft with no pill takes the no-target path', async () => {
    __filterProjectIds = new Set();
    __activeProjectId = undefined;

    const { result } = renderHook(() => useStartNewSession());
    act(() => result.current());

    expect(openNewThreadDraft).not.toHaveBeenCalled();
    expect(resetNewThreadDraft).toHaveBeenCalledExactlyOnceWith('__LOCALID_1');
    expect(useDraftReturnTarget.getState().returnThreadId).toBe('chat-7');
    expect(switchToNewThread).toHaveBeenCalledTimes(1);
  });
});

describe('useStartNewSession — pending-target lifetime', () => {
  it('sets the pending target before the sequence starts and clears it once it settles', async () => {
    __filterProjectIds = new Set(['proj-pill']);
    let duringCall: string | null = null;
    openNewThreadDraft.mockImplementationOnce(async () => {
      duringCall = usePendingDraftProject.getState().projectId;
    });

    const { result } = renderHook(() => useStartNewSession());
    await act(async () => {
      result.current();
      await flush();
    });

    expect(duringCall).toBe('proj-pill');
    expect(usePendingDraftProject.getState().projectId).toBeNull();
  });

  it('clears the pending target even when the sequence rejects', async () => {
    __filterProjectIds = new Set(['proj-pill']);
    openNewThreadDraft.mockImplementationOnce(async () => {
      throw new Error('boom');
    });

    const { result } = renderHook(() => useStartNewSession());
    await act(async () => {
      result.current();
      await flush();
    });

    expect(usePendingDraftProject.getState().projectId).toBeNull();
  });

  it('never sets a pending target on the no-target path', () => {
    __filterProjectIds = new Set();
    __activeProjectId = undefined;

    const { result } = renderHook(() => useStartNewSession());
    act(() => result.current());

    expect(usePendingDraftProject.getState().projectId).toBeNull();
  });
});

describe('useStartNewSession — same-target repeat while the draft is in flight', () => {
  it('is a no-op when the active thread is already the slot resolving the same pending target', async () => {
    __mainThreadId = '__LOCALID_1';
    __newThreadId = '__LOCALID_1';
    __filterProjectIds = new Set(['proj-pill']);
    usePendingDraftProject.getState().setPendingProject('proj-pill');

    const { result } = renderHook(() => useStartNewSession());
    act(() => result.current());

    expect(openNewThreadDraft).not.toHaveBeenCalled();
    expect(resetNewThreadDraft).not.toHaveBeenCalled();
    expect(switchToNewThread).not.toHaveBeenCalled();
  });

  it('re-runs the full sequence when the pill changes to a different target mid-flight', async () => {
    __mainThreadId = '__LOCALID_1';
    __newThreadId = '__LOCALID_1';
    __filterProjectIds = new Set(['proj-new']);
    usePendingDraftProject.getState().setPendingProject('proj-old');

    const { result } = renderHook(() => useStartNewSession());
    await act(async () => {
      result.current();
      await flush();
    });

    expect(openNewThreadDraft).toHaveBeenCalledExactlyOnceWith({ projectId: 'proj-new' });
  });

  it('does not skip the no-target path when it is a different in-flight target with no active project or pill', async () => {
    // A ready (not blocking) record on the active slot still lets a genuinely
    // projectless trigger fall through as today's no-target path would — this
    // only exercises resolution, not the no-op guard.
    __mainThreadId = '__LOCALID_1';
    __newThreadId = '__LOCALID_1';
    __filterProjectIds = new Set();
    __activeProjectId = undefined;

    const { result } = renderHook(() => useStartNewSession());
    act(() => result.current());

    expect(useDraftReturnTarget.getState().returnThreadId).toBeNull();
    expect(resetNewThreadDraft).toHaveBeenCalledExactlyOnceWith('__LOCALID_1');
  });
});
