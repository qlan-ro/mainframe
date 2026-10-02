// @vitest-environment jsdom

/**
 * Real-runtime regression — todo #375.
 *
 * Reproduces the confirmed race: the active thread is a committed local
 * draft (a `__LOCALID_*` id that already has a stamped `remoteId`), the user
 * triggers New, and while `switchToNewThread()` awaits runtime attachment a
 * list reload lets `useSessionListRouter`'s first-send adoption switch to
 * the canonical saved session out from under the still-settling New —
 * cancelling it and producing `openNewThreadDraft`'s "Couldn't open a new
 * session" toast.
 *
 * Mounts the REAL `@assistant-ui/react` remote-thread-list runtime (a
 * controllable in-memory adapter, no network) plus the real
 * `useSessionListRouter` and `openNewThreadDraft`. The one controlled seam is
 * the library's thread attachment —
 * `RemoteThreadListHookInstanceManager.prototype.startThreadRuntime`
 * (`@assistant-ui/core@0.3.12`) — held open for a chosen thread id so the
 * test can interleave a competing automatic switch inside the exact window
 * `_switchToThread` awaits before it is allowed to commit
 * (`src/react/runtimes/RemoteThreadListThreadListRuntimeCore.tsx`, see the
 * plan's Established facts).
 */
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FC } from 'react';
import {
  AssistantRuntimeProvider,
  useAui,
  useExternalStoreRuntime,
  useRemoteThreadListRuntime,
} from '@assistant-ui/react';
import type { AssistantClient, AssistantRuntime, RemoteThreadListAdapter, ThreadMessage } from '@assistant-ui/react';
import { RemoteThreadListHookInstanceManager } from '@assistant-ui/core/react';
import { openNewThreadDraft, type OpenNewThreadDraftDeps } from '../../new-thread/open-new-thread-draft';
import { useNewThreadSwitchPending } from '../../new-thread/new-thread-switch-pending';

vi.mock('../../../../lib/daemon/ws-client', () => ({
  daemonWs: { onEvent: vi.fn(() => () => {}) },
}));
vi.mock('../../../../lib/host', () => ({
  getHost: () => ({ notify: async () => {} }),
}));

import { useSessionListRouter } from '../../ws/use-session-list-router';

const useStubThreadRuntime = (): AssistantRuntime =>
  useExternalStoreRuntime<ThreadMessage>({ isRunning: false, messages: [], onNew: async () => {} });

interface ThreadFixture {
  status: 'regular' | 'archived';
  remoteId: string;
  title: string;
  updatedAt?: number;
  /** Non-null required: `threadItemsToSessionItems` drops any list entry without one (hasSessionCustom). */
  custom: Record<string, unknown>;
}

function fixture(remoteId: string, updatedAt: number): ThreadFixture {
  return { status: 'regular', remoteId, title: 'Committed', updatedAt, custom: { projectId: 'proj-a', updatedAt } };
}

/**
 * Holds `startThreadRuntime` open for ids matching `hold`, releasable en
 * masse without needing to know the generated local id in advance — the real
 * attach (`original.call`) still runs underneath, so the instance mounts and
 * its own promise settles; only the CALLER's visibility of that settlement
 * is deferred.
 */
function installAttachmentGate() {
  const original = RemoteThreadListHookInstanceManager.prototype.startThreadRuntime;
  let shouldHold: (threadId: string) => boolean = () => false;
  const releases = new Map<string, () => void>();
  const spy = vi
    .spyOn(RemoteThreadListHookInstanceManager.prototype, 'startThreadRuntime')
    .mockImplementation(function (this: RemoteThreadListHookInstanceManager, threadId: string) {
      const attached = original.call(this, threadId);
      if (!shouldHold(threadId)) return attached;
      return new Promise<void>((resolve) => releases.set(threadId, resolve)).then(() => attached);
    });
  return {
    hold: (pred: (threadId: string) => boolean) => {
      shouldHold = pred;
    },
    releaseAll: () => {
      for (const release of releases.values()) release();
      releases.clear();
    },
    restore: () => spy.mockRestore(),
  };
}

function mountHarness(adapter: RemoteThreadListAdapter) {
  const auiRef: { current: AssistantClient | null } = { current: null };
  const Capture: FC = () => {
    auiRef.current = useAui();
    useSessionListRouter();
    return null;
  };
  const Root: FC = () => {
    const runtime = useRemoteThreadListRuntime({ runtimeHook: useStubThreadRuntime, adapter });
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <Capture />
      </AssistantRuntimeProvider>
    );
  };

  const utils = render(<Root />);
  if (!auiRef.current) throw new Error('aui client not captured');
  return { aui: () => auiRef.current!, unmount: utils.unmount };
}

/** Builds the in-memory adapter; `threads` is read live via the closure so a test can mutate it before a reload. */
function makeAdapter(threadsRef: { current: ThreadFixture[] }): { adapter: RemoteThreadListAdapter } {
  let nextRemoteId = 1;
  const adapter: RemoteThreadListAdapter = {
    list: async () => ({ threads: threadsRef.current }),
    fetch: async (id: string) => threadsRef.current.find((t) => t.remoteId === id) ?? threadsRef.current[0]!,
    rename: async () => {},
    archive: async () => {},
    unarchive: async () => {},
    delete: async () => {},
    initialize: async () => ({ remoteId: `chat-${nextRemoteId++}`, externalId: undefined }),
    generateTitle: () => Promise.resolve(new ReadableStream()),
  };
  return { adapter };
}

/** Drain microtasks under `act` so aui's internal optimistic-update machinery settles. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

let gate: ReturnType<typeof installAttachmentGate>;

beforeEach(() => {
  gate = installAttachmentGate();
  useNewThreadSwitchPending.setState({ count: 0 });
});

afterEach(() => {
  gate.restore();
});

function makeDeps(aui: () => AssistantClient, overrides: Partial<OpenNewThreadDraftDeps> = {}): OpenNewThreadDraftDeps {
  return {
    filterProjectIds: new Set(),
    clearProjectFilter: vi.fn(),
    runtimeThreads: aui().threads,
    setReturnTarget: vi.fn(),
    resetNewThreadDraft: vi.fn(),
    initializeDraft: vi.fn(async () => ({})),
    setText: vi.fn(),
    mfToastError: vi.fn(),
    ...overrides,
  };
}

describe('new-thread activation overlap — todo #375', () => {
  it('a committed-local list refresh DURING a pending New no longer races it into the toast', async () => {
    const threadsRef = { current: [] as ThreadFixture[] };
    const { adapter } = makeAdapter(threadsRef);
    const { aui, unmount } = mountHarness(adapter);

    await waitFor(() => expect(aui().threads.getState().mainThreadId).toBeTruthy());
    const committedLocalId = aui().threads.getState().mainThreadId!;

    // Commit the active draft (aui's own first-send seam): stamps a remoteId
    // while the main thread id stays the LOCAL id.
    await act(async () => {
      await aui().threads.item('main').initialize();
    });
    await flush();
    const draftRemoteId = aui().threads.item('main').getState().remoteId!;
    expect(draftRemoteId).toBeTruthy();
    expect(aui().threads.getState().mainThreadId).toBe(committedLocalId);

    // The canonical row now exists server-side, but the client hasn't reloaded it yet.
    threadsRef.current = [fixture(draftRemoteId, 1000)];

    // Hold attachment for whatever fresh local id New is about to create.
    gate.hold((id) => id.startsWith('__LOCALID_') && id !== committedLocalId);

    const mfToastError = vi.fn();
    const initializeDraft = vi.fn(async () => ({}));
    const openPromise = openNewThreadDraft({ projectId: 'proj-a' }, makeDeps(aui, { mfToastError, initializeDraft }));
    await flush();

    // The list reloads while New is still held mid-attachment — the exact
    // interleaving the race needs.
    await act(async () => {
      await aui().threads.reload();
    });
    await flush();

    // Let New's held attachment settle, then let the bounded wait play out.
    await act(async () => {
      gate.releaseAll();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await openPromise;
    });

    expect(mfToastError).not.toHaveBeenCalled();
    const newDraftId = aui().threads.getState().mainThreadId!;
    expect(newDraftId).not.toBe(draftRemoteId);
    expect(newDraftId.startsWith('__LOCALID_')).toBe(true);
    expect(initializeDraft).toHaveBeenCalledWith(expect.objectContaining({ localId: newDraftId }));
    // The saved session is still in the list, just no longer active.
    expect(threadsRef.current.some((t) => t.remoteId === draftRemoteId)).toBe(true);

    unmount();
  }, 10_000);

  it('a slow (but uncontested) attachment past the one-second poll bound still activates — not a timeout effect', async () => {
    const threadsRef = { current: [] as ThreadFixture[] };
    const { adapter } = makeAdapter(threadsRef);
    const { aui, unmount } = mountHarness(adapter);

    await waitFor(() => expect(aui().threads.getState().mainThreadId).toBeTruthy());
    const bootId = aui().threads.getState().mainThreadId!;

    gate.hold((id) => id.startsWith('__LOCALID_') && id !== bootId);

    const mfToastError = vi.fn();
    const initializeDraft = vi.fn(async () => ({}));
    const openPromise = openNewThreadDraft({ projectId: 'proj-a' }, makeDeps(aui, { mfToastError, initializeDraft }));
    await flush();

    // Hold attachment well past the 1000ms activation-poll bound — nothing
    // else is racing it, so it must still activate once released.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      gate.releaseAll();
      await openPromise;
    });

    expect(mfToastError).not.toHaveBeenCalled();
    expect(initializeDraft).toHaveBeenCalledTimes(1);

    unmount();
  }, 10_000);
});
