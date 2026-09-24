// @vitest-environment jsdom

/**
 * SessionRow — fork lineage rendering (todo #343, AC 13/14).
 *
 * Reuses SessionRow.test.tsx's real-runtime harness (a stub thread list +
 * SessionRowItemScope) since the lineage hook reads `useAui().threads` for
 * the fallback glyph's activate action. `getChat` is mocked for the
 * archived/deleted cases, which fall through to `use-parent-chat`.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FC } from 'react';
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
import { SessionRow } from '../SessionRow';

const getChatMock = vi.fn();
vi.mock('@/lib/api/chats', () => ({ getChat: (...args: unknown[]) => getChatMock(...args) }));

import { ApiRequestError } from '@/lib/api/http';
import { __resetParentChatCacheForTests } from '../use-parent-chat';

const PORT = 31415;

const THREADS = [
  { status: 'regular' as const, remoteId: 'parent-1', title: 'Parent Chat' },
  { status: 'regular' as const, remoteId: 'fork-1', title: 'Fork Chat' },
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

const Harness: FC<{
  item: SessionItem;
  depth: 0 | 1 | 2;
  lineage: SessionLineageContextValue;
  main: { id: string | null };
}> = ({ item, depth, lineage, main }) => {
  const runtime = useRemoteThreadListRuntime({ runtimeHook: useStubThreadRuntime, adapter });
  return (
    <TooltipProvider>
      <DaemonPortProvider port={PORT}>
        <SidebarProvider>
          <AssistantRuntimeProvider runtime={runtime}>
            <RowUnderTest item={item} depth={depth} lineage={lineage} main={main} />
          </AssistantRuntimeProvider>
        </SidebarProvider>
      </DaemonPortProvider>
    </TooltipProvider>
  );
};

function renderRow(item: SessionItem, depth: 0 | 1 | 2, lineage: SessionLineageContextValue) {
  const main: { id: string | null } = { id: null };
  render(<Harness item={item} depth={depth} lineage={lineage} main={main} />);
  return main;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetParentChatCacheForTests();
});

const parentItem = makeItem('parent-1', 'Parent Chat');
const forkItem = makeItem('fork-1', 'Fork Chat', 'parent-1');

describe('SessionRow — nested fork (depth > 0)', () => {
  it('wraps the row in the nest wrapper with the leading glyph, and no fallback glyph', async () => {
    renderRow(forkItem, 1, {
      allItems: [parentItem, forkItem],
      listedIds: new Set(['parent-1', 'fork-1']),
      unfilteredIds: new Set(['parent-1', 'fork-1']),
    });

    await waitFor(() => expect(screen.getByText('Fork Chat')).toBeTruthy());
    const nest = screen.getByTestId('sessions-row-fork-nest');
    expect(nest.querySelector('[data-chat-id="fork-1"]')).toBeTruthy();
    expect(screen.getByTestId('sessions-row-fork-nest-glyph')).toBeTruthy();
    expect(screen.queryByTestId('sessions-row-parent-link')).toBeNull();
  });

  it('renders no nest wrapper for a root chat (depth 0, no parent)', async () => {
    renderRow(parentItem, 0, {
      allItems: [parentItem],
      listedIds: new Set(['parent-1']),
      unfilteredIds: new Set(['parent-1']),
    });

    await waitFor(() => expect(screen.getByText('Parent Chat')).toBeTruthy());
    expect(screen.queryByTestId('sessions-row-fork-nest')).toBeNull();
    expect(screen.queryByTestId('sessions-row-parent-link')).toBeNull();
  });
});

describe('SessionRow — fallback glyph (depth 0, parent not adjacent)', () => {
  it('reads the different-group Hint and activates the parent without activating the fork row', async () => {
    const main = renderRow(forkItem, 0, {
      allItems: [parentItem, forkItem],
      listedIds: new Set(['parent-1']), // parent listed, but not alongside the fork
      unfilteredIds: new Set(['parent-1', 'fork-1']),
    });

    await waitFor(() => expect(screen.getByText('Fork Chat')).toBeTruthy());
    const glyph = screen.getByTestId('sessions-row-parent-link');

    fireEvent.click(glyph);
    await waitFor(() => expect(main.id).toBe('parent-1'));
  });

  it('reads the filtered-out Hint (no suffix) when the parent is loaded but not listed anywhere', async () => {
    renderRow(forkItem, 0, {
      allItems: [parentItem, forkItem],
      listedIds: new Set(),
      unfilteredIds: new Set(['parent-1', 'fork-1']),
    });

    await waitFor(() => expect(screen.getByText('Fork Chat')).toBeTruthy());
    expect(screen.getByTestId('sessions-row-parent-link')).toBeTruthy();
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
    const main = renderRow(forkItem, 0, {
      allItems: [forkItem],
      listedIds: new Set(),
      unfilteredIds: new Set(['fork-1']),
    });

    await waitFor(() => expect(screen.getByTestId('sessions-row-parent-link')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sessions-row-parent-link'));
    expect(main.id).not.toBe('parent-1');
  });

  it('resolves deleted via a 404 and is not interactive', async () => {
    getChatMock.mockRejectedValue(new ApiRequestError('not found', [], 404));
    const main = renderRow(forkItem, 0, {
      allItems: [forkItem],
      listedIds: new Set(),
      unfilteredIds: new Set(['fork-1']),
    });

    await waitFor(() => expect(screen.getByTestId('sessions-row-parent-link')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sessions-row-parent-link'));
    expect(main.id).not.toBe('parent-1');
  });
});
