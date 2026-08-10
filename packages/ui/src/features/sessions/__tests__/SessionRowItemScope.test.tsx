// @vitest-environment jsdom

/**
 * SessionRowItemScope — the by-id `threadListItem` scope a session row runs in.
 *
 * This mounts a REAL remote thread list (the same `useRemoteThreadListRuntime`
 * composition the sessions runtime uses) over a fake adapter, so nothing about
 * the scope machinery is stubbed. Two crossings are under test and neither is
 * visible to `tsc`, because `Derived` is typed `any` at `@assistant-ui/store`:
 *
 *  1. The module writes the scope with `Derived` from `@assistant-ui/store`
 *     (a direct dependency) while every probe here READS it through
 *     `@assistant-ui/react`'s re-exports. A second `@assistant-ui/store` copy
 *     in the lockfile would split that React context and every session row
 *     would silently stop working; here it reds the suite instead.
 *  2. The scope must resolve the item named by `id` — not the main thread and
 *     not a sibling row — for both state reads and action calls.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FC } from 'react';
import {
  AssistantRuntimeProvider,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
  useRemoteThreadListRuntime,
} from '@assistant-ui/react';
import type { AssistantRuntime, RemoteThreadListAdapter, ThreadMessage } from '@assistant-ui/react';
import { SessionRowItemScope } from '../SessionRowItemScope';

// ---------------------------------------------------------------------------
// A fake remote thread list — two regular threads, distinguishable by title.
// ---------------------------------------------------------------------------

const THREADS = [
  { status: 'regular' as const, remoteId: 'chat-a', title: 'Alpha' },
  { status: 'regular' as const, remoteId: 'chat-b', title: 'Beta' },
];

const renameSpy = vi.fn(async () => {});
const archiveSpy = vi.fn(async () => {});

const adapter: RemoteThreadListAdapter = {
  list: async () => ({ threads: THREADS }),
  fetch: async (threadId: string) => THREADS.find((t) => t.remoteId === threadId) ?? THREADS[0]!,
  rename: renameSpy,
  archive: archiveSpy,
  unarchive: async () => {},
  delete: async () => {},
  initialize: async (threadId: string) => ({ remoteId: threadId, externalId: undefined }),
  generateTitle: () => Promise.resolve(new ReadableStream()),
};

const useStubThreadRuntime = (): AssistantRuntime =>
  useExternalStoreRuntime<ThreadMessage>({ isRunning: false, messages: [], onNew: async () => {} });

// ---------------------------------------------------------------------------
// Probe — reads and acts on whatever `threadListItem` its scope resolved to.
// ---------------------------------------------------------------------------

const Probe: FC = () => {
  const aui = useAui();
  const id = useAuiState((s) => s.threadListItem.id);
  const title = useAuiState((s) => s.threadListItem.title);
  return (
    <button data-testid={`probe-${title ?? 'untitled'}`} onClick={() => aui.threadListItem().rename(`${title}!`)}>
      {id}
    </button>
  );
};

interface SeenEntry {
  id: string;
  title: string | undefined;
}

/**
 * One scope per listed thread, mirroring how the session list renders rows.
 * The list also carries the boot main thread, which the fake adapter never
 * listed — hence the lookup by title rather than by position.
 */
const Rows: FC<{ seen: SeenEntry[]; main: { id: string | null } }> = ({ seen, main }) => {
  const threadItems = useAuiState((s) => s.threads.threadItems);
  main.id = useAuiState((s) => s.threads.mainThreadId);
  seen.length = 0;
  seen.push(...threadItems.map((t) => ({ id: t.id, title: t.title })));
  return (
    <>
      {threadItems.map((t) => (
        <SessionRowItemScope key={t.id} id={t.id}>
          <Probe />
        </SessionRowItemScope>
      ))}
    </>
  );
};

const Harness: FC<{ seen: SeenEntry[]; main: { id: string | null } }> = ({ seen, main }) => {
  const runtime = useRemoteThreadListRuntime({ runtimeHook: useStubThreadRuntime, adapter });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Rows seen={seen} main={main} />
    </AssistantRuntimeProvider>
  );
};

interface MountedRows {
  idOf: (title: string) => string | undefined;
  count: () => number;
  mainThreadId: () => string | null;
}

async function mountRows(): Promise<MountedRows> {
  const seen: SeenEntry[] = [];
  const main: { id: string | null } = { id: null };
  render(<Harness seen={seen} main={main} />);
  await waitFor(() => expect(screen.getByTestId('probe-Alpha')).toBeTruthy());
  return {
    idOf: (title: string) => seen.find((e) => e.title === title)?.id,
    count: () => seen.length,
    mainThreadId: () => main.id,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SessionRowItemScope', () => {
  it('resolves the scope to the item named by id, not to the main thread', async () => {
    const { idOf, mainThreadId } = await mountRows();

    expect(screen.getByTestId('probe-Alpha').textContent).toBe(idOf('Alpha'));
    expect(screen.getByTestId('probe-Alpha').textContent).not.toBe(mainThreadId());
  });

  it('gives sibling scopes their own item rather than leaking one across rows', async () => {
    const { idOf, count } = await mountRows();

    expect(screen.getByTestId('probe-Alpha').textContent).toBe(idOf('Alpha'));
    expect(screen.getByTestId('probe-Beta').textContent).toBe(idOf('Beta'));
    expect(idOf('Alpha')).not.toBe(idOf('Beta'));
    expect(count()).toBeGreaterThanOrEqual(2);
  });

  it('routes an action on the scope to that row’s thread', async () => {
    await mountRows();

    screen.getByTestId('probe-Beta').click();

    await waitFor(() => expect(renameSpy).toHaveBeenCalledTimes(1));
    expect(renameSpy).toHaveBeenCalledWith('chat-b', 'Beta!');
  });
});
