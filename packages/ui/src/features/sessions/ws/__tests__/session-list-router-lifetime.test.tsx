// @vitest-environment jsdom

/**
 * useSessionListRouter — the WS wiring outlives a session switch.
 *
 * The router is created ONCE and disposed on unmount: its closure owns the
 * reload debounce (a 200 ms cooling window plus a `trailing` flag), so a
 * re-created router silently drops a queued trailing reload and leaves the
 * sidebar on stale metadata until the next event.
 *
 * That invariant rests on a library fact `tsc` cannot see and the hook's own
 * unit test cannot either (it injects one stable fake client): in 0.15
 * `useAui()` returns a NEW client on every main-thread switch, while the
 * `threads` scope it exposes keeps its identity. Depending on the client would
 * re-run the effect on every switch. This mounts the real remote-thread-list
 * runtime and switches threads to pin both halves.
 */
import { render, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FC } from 'react';

const disposeSpy = vi.fn();
let factoryCallCount = 0;

vi.mock('../../../../lib/daemon/ws-client', () => ({
  daemonWs: { onEvent: vi.fn(() => () => {}) },
}));

vi.mock('../session-list-router', () => ({
  createSessionListRouter: vi.fn(() => {
    factoryCallCount += 1;
    return { dispose: disposeSpy };
  }),
}));

vi.mock('../../../../lib/host', () => ({
  getHost: () => ({ notify: async () => {} }),
}));

import {
  AssistantRuntimeProvider,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
  useRemoteThreadListRuntime,
} from '@assistant-ui/react';
import type { AssistantClient, AssistantRuntime, RemoteThreadListAdapter, ThreadMessage } from '@assistant-ui/react';
import { useSessionListRouter } from '../use-session-list-router';

const THREADS = [
  { status: 'regular' as const, remoteId: 'chat-a', title: 'Alpha' },
  { status: 'regular' as const, remoteId: 'chat-b', title: 'Beta' },
];

const adapter: RemoteThreadListAdapter = {
  list: async () => ({ threads: THREADS }),
  fetch: async (id: string) => THREADS.find((t) => t.remoteId === id) ?? THREADS[0]!,
  rename: async () => {},
  archive: async () => {},
  unarchive: async () => {},
  delete: async () => {},
  initialize: async (id: string) => ({ remoteId: id, externalId: undefined }),
  generateTitle: () => Promise.resolve(new ReadableStream()),
};

const useStubThreadRuntime = (): AssistantRuntime =>
  useExternalStoreRuntime<ThreadMessage>({ isRunning: false, messages: [], onNew: async () => {} });

interface Probe {
  client: AssistantClient | null;
  clients: AssistantClient[];
  scopes: unknown[];
  ids: string[];
}

const Subject: FC<{ probe: Probe }> = ({ probe }) => {
  useSessionListRouter();
  const aui = useAui();
  const items = useAuiState((s) => s.threads.threadItems);
  probe.client = aui;
  probe.ids = items.map((t) => t.id);
  if (probe.clients[probe.clients.length - 1] !== aui) probe.clients.push(aui);
  if (probe.scopes[probe.scopes.length - 1] !== aui.threads) probe.scopes.push(aui.threads);
  return null;
};

const Harness: FC<{ probe: Probe }> = ({ probe }) => {
  const runtime = useRemoteThreadListRuntime({ runtimeHook: useStubThreadRuntime, adapter });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Subject probe={probe} />
    </AssistantRuntimeProvider>
  );
};

async function mountAndSwitch(): Promise<Probe> {
  const probe: Probe = { client: null, clients: [], scopes: [], ids: [] };
  render(<Harness probe={probe} />);
  await waitFor(() => expect(probe.ids.length).toBeGreaterThanOrEqual(2));

  const target = probe.ids[probe.ids.length - 1]!;
  await act(async () => {
    probe.client!.threads.switchToThread(target);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return probe;
}

beforeEach(() => {
  factoryCallCount = 0;
  disposeSpy.mockClear();
});

describe('useSessionListRouter — WS wiring lifetime', () => {
  it('keeps the one router it created across a session switch', async () => {
    await mountAndSwitch();

    expect(factoryCallCount).toBe(1);
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it('sees a fresh aui client but the same threads scope after that switch', async () => {
    const probe = await mountAndSwitch();

    expect(probe.clients.length).toBeGreaterThan(1);
    expect(probe.scopes.length).toBe(1);
  });
});
