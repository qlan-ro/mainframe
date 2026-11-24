// @vitest-environment jsdom

/**
 * SessionRow — fork lineage rendering (todo #343, AC 13/14).
 *
 * Reuses SessionRow.test.tsx's real-runtime harness (a stub thread list +
 * SessionRowItemScope) since the lineage hook reads `useAui().threads` for
 * opening the parent. `getChat` is mocked for the
 * archived/deleted cases, which fall through to `use-parent-chat`.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FC, ReactNode } from 'react';
import {
  AssistantRuntimeProvider,
  useAuiState,
  useExternalStoreRuntime,
  useRemoteThreadListRuntime,
} from '@assistant-ui/react';
import type { AssistantRuntime, RemoteThreadListAdapter, ThreadMessage } from '@assistant-ui/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DaemonPortProvider } from '../runtime/daemon-port-context';
import { SessionLineageProvider, type SessionLineageContextValue } from '../SessionLineageContext';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { SessionMetaCard } from '../SessionMetaCard';
import { SessionRow } from '../SessionRow';
import { useForkLineageRow } from '../sidebar/use-fork-lineage-row';

const getChatMock = vi.fn();
vi.mock('@/lib/api/chats', () => ({ getChat: (...args: unknown[]) => getChatMock(...args) }));

import { ApiRequestError } from '@/lib/api/http';
import { __resetParentChatCacheForTests } from '../use-parent-chat';

const PORT = 31415;

const THREADS = [
  { status: 'regular' as const, remoteId: 'parent-1', title: 'Parent Chat' },
  { status: 'regular' as const, remoteId: 'fork-1', title: 'Fork Chat' },
  { status: 'regular' as const, remoteId: 'grandfork-1', title: 'Grandfork Chat' },
];

const adapter: RemoteThreadListAdapter = {
  list: async () => ({ threads: THREADS }),
  fetch: async (threadId: string) => THREADS.find((t) => t.remoteId === threadId) ?? THREADS[0]!,
  rename: async () => {},
  archive: async () => {},
  unarchive: async () => {},
  delete: async () => {},
  initialize: async (threadId: string) => ({ remoteId: threadId, externalId: undefined }),
  generateTitle: () => Promise.resolve(new ReadableStream()),
};

const useStubThreadRuntime = (): AssistantRuntime =>
  useExternalStoreRuntime<ThreadMessage>({ isRunning: false, messages: [], onNew: async () => {} });

function makeItem(id: string, title: string, parentChatId?: string): SessionItem {
  return {
    id,
    remoteId: id,
    title,
    status: 'regular',
    custom: {
      projectId: 'proj-a',
      adapterId: 'claude',
      tags: [],
      pinned: false,
      temporary: false,
      noProject: false,
      status: 'active',
      displayStatus: 'idle',
      hasPending: false,
      detectedPrs: [],
      worktreeMissing: false,
      transcriptMissing: false,
      updatedAt: Date.now(),
      parentChatId,
    },
  };
}

const RowUnderTest: FC<{
  item: SessionItem;
  depth: 0 | 1 | 2;
  lineage: SessionLineageContextValue;
  main: { id: string | null };
}> = ({ item, depth, lineage, main }) => {
  main.id = useAuiState((s) => s.threads.mainThreadId);
  return (
    <SessionLineageProvider value={lineage}>
      <SessionRow item={item} depth={depth} />
    </SessionLineageProvider>
  );
};

const Providers: FC<{ children: ReactNode }> = ({ children }) => {
  const runtime = useRemoteThreadListRuntime({ runtimeHook: useStubThreadRuntime, adapter });
  return (
    <TooltipProvider>
      <DaemonPortProvider port={PORT}>
        <SidebarProvider>
          <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
        </SidebarProvider>
      </DaemonPortProvider>
    </TooltipProvider>
  );
};

function renderRow(item: SessionItem, depth: 0 | 1 | 2, lineage: SessionLineageContextValue) {
  const main: { id: string | null } = { id: null };
  render(
    <Providers>
      <RowUnderTest item={item} depth={depth} lineage={lineage} main={main} />
    </Providers>,
  );
  return main;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetParentChatCacheForTests();
});

const parentItem = makeItem('parent-1', 'Parent Chat');
const forkItem = makeItem('fork-1', 'Fork Chat', 'parent-1');

describe('SessionRow — nested fork (depth > 0)', () => {
  it('wraps the row in the nest wrapper', async () => {
    renderRow(forkItem, 1, {
      allItems: [parentItem, forkItem],
      listedIds: new Set(['parent-1', 'fork-1']),
      unfilteredIds: new Set(['parent-1', 'fork-1']),
    });

    await waitFor(() => expect(screen.getByText('Fork Chat')).toBeTruthy());
    const nest = screen.getByTestId('sessions-row-fork-nest');
    expect(nest.querySelector('[data-chat-id="fork-1"]')).toBeTruthy();
  });

  it('wraps a depth-2 fork-of-fork row in two nest wrappers, not a single one', async () => {
    const grandforkItem = makeItem('grandfork-1', 'Grandfork Chat', 'fork-1');
    renderRow(grandforkItem, 2, {
      allItems: [parentItem, forkItem, grandforkItem],
      listedIds: new Set(['parent-1', 'fork-1', 'grandfork-1']),
      unfilteredIds: new Set(['parent-1', 'fork-1', 'grandfork-1']),
    });

    await waitFor(() => expect(screen.getByText('Grandfork Chat')).toBeTruthy());
    const outer = screen.getByTestId('sessions-row-fork-nest-2');
    const inner = screen.getByTestId('sessions-row-fork-nest');
    // The depth-2 row is nested inside the depth-1 wrapper, which is nested
    // inside the depth-2 wrapper — two indent steps, not a single one that
    // would make it look like a sibling of its own parent.
    expect(outer.contains(inner)).toBe(true);
    expect(inner.querySelector('[data-chat-id="grandfork-1"]')).toBeTruthy();
  });

  it('renders no nest wrapper for a root chat (depth 0, no parent)', async () => {
    renderRow(parentItem, 0, {
      allItems: [parentItem],
      listedIds: new Set(['parent-1']),
      unfilteredIds: new Set(['parent-1']),
    });

    await waitFor(() => expect(screen.getByText('Parent Chat')).toBeTruthy());
    expect(screen.queryByTestId('sessions-row-fork-nest')).toBeNull();
  });
});

/** The row's own lineage hook feeding its hover card, without the hover. */
const CardUnderTest: FC<{ item: SessionItem; main: { id: string | null } }> = ({ item, main }) => {
  main.id = useAuiState((s) => s.threads.mainThreadId);
  // Switching to a thread the list has not loaded yet throws.
  const loaded = useAuiState((s) => s.threads.threadItems.some((t) => t.id === 'parent-1'));
  const lineage = useForkLineageRow(item, 0);
  if (!loaded) return null;
  return (
    <SessionMetaCard
      title={item.title ?? ''}
      worktreeMissing={false}
      transcriptMissing={false}
      detectedPrs={[]}
      tags={[]}
      parentState={lineage.parentState}
      onOpenParent={lineage.onOpenParent}
    />
  );
};

function renderCard(item: SessionItem, lineage: SessionLineageContextValue) {
  const main: { id: string | null } = { id: null };
  render(
    <Providers>
      <SessionLineageProvider value={lineage}>
        <CardUnderTest item={item} main={main} />
      </SessionLineageProvider>
    </Providers>,
  );
  return main;
}

describe('the hover card names a parent the row is not nested under', () => {
  it('opens a parent listed in another group', async () => {
    const main = renderCard(forkItem, {
      allItems: [parentItem, forkItem],
      listedIds: new Set(['parent-1']), // parent listed, but not alongside the fork
      unfilteredIds: new Set(['parent-1', 'fork-1']),
    });

    fireEvent.click(await screen.findByTestId('sessions-meta-card-open-parent'));
    await waitFor(() => expect(main.id).toBe('parent-1'));
  });

  it('opens a parent a filter hides from the list', async () => {
    const main = renderCard(forkItem, {
      allItems: [parentItem, forkItem],
      listedIds: new Set(),
      unfilteredIds: new Set(['parent-1', 'fork-1']),
    });

    fireEvent.click(await screen.findByTestId('sessions-meta-card-open-parent'));
    await waitFor(() => expect(main.id).toBe('parent-1'));
  });

  it('resolves archived via use-parent-chat and is not interactive', async () => {
    getChatMock.mockResolvedValue({
      id: 'parent-1',
      status: 'archived',
      title: 'Parent Chat',
      adapterId: 'claude',
      projectId: 'proj-a',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      lastContextTokensInput: 0,
    });
    renderCard(forkItem, {
      allItems: [forkItem],
      listedIds: new Set(),
      unfilteredIds: new Set(['fork-1']),
    });

    expect(await screen.findByTestId('sessions-meta-card-forked-from')).toHaveTextContent('"Parent Chat" (archived)');
    expect(screen.queryByTestId('sessions-meta-card-open-parent')).toBeNull();
  });

  it('resolves deleted via a 404 and is not interactive', async () => {
    getChatMock.mockRejectedValue(new ApiRequestError('not found', [], 404));
    renderCard(forkItem, {
      allItems: [forkItem],
      listedIds: new Set(),
      unfilteredIds: new Set(['fork-1']),
    });

    expect(await screen.findByTestId('sessions-meta-card-forked-from')).toHaveTextContent('a deleted chat');
    expect(screen.queryByTestId('sessions-meta-card-open-parent')).toBeNull();
  });
});
