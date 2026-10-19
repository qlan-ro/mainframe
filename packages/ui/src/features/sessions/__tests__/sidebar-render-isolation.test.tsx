// @vitest-environment jsdom

/**
 * Render isolation for the session list over the REAL remote thread-list
 * runtime and the real chats adapter (only the REST layer is stubbed):
 *
 *  1. A background chat's `chat.updated` that only moves cost/tokens reloads
 *     the list without re-rendering any row or the identity consumer.
 *  2. A background chat whose own status moves re-renders that row only.
 *  3. A chat switch costs an uninvolved row one render at most: the one aui
 *     forces on every client consumer by handing out a fresh client context
 *     on each switch (selectors cannot avoid it). Nothing row-level adds to it.
 *  4. An unread mark re-renders only the marked row.
 *  5. Main-thread token churn re-renders no row, no list host and no
 *     identity consumer (aui rebuilds `threads.threadItems` per chunk).
 *
 * Rows are the real `SessionRow`; its body is swapped for a counter, which
 * renders exactly when the row's inner component does.
 */
import { act, render, waitFor } from '@testing-library/react';
import { useMemo, useSyncExternalStore, type FC } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssistantRuntimeProvider,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
  useRemoteThreadListRuntime,
} from '@assistant-ui/react';
import type { AssistantRuntime, ThreadMessageLike } from '@assistant-ui/react';
import type { Chat, Project } from '@qlan-ro/mainframe-types';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useStableList } from '@/lib/use-stable-list';
import { useUnreadStore } from '@/store/unread-store';

const { rowRenders, listChatsMock } = vi.hoisted(() => ({
  rowRenders: new Map<string, number>(),
  listChatsMock: vi.fn(),
}));

vi.mock('@/lib/api/chats', () => ({
  listChats: listChatsMock,
  getChat: vi.fn(),
  renameChat: vi.fn(),
  archiveChat: vi.fn(),
  discardChat: vi.fn(),
  unarchiveChat: vi.fn(),
}));

vi.mock('../SessionRowBody', () => ({
  RowBody: ({ item }: { item: { id: string; title?: string } }) => {
    rowRenders.set(item.id, (rowRenders.get(item.id) ?? 0) + 1);
    return <span data-testid="sessions-row-title">{item.title}</span>;
  },
}));

const PROJECTS: Project[] = [{ id: 'proj-a', name: 'Alpha', path: '/repos/alpha' } as Project];
vi.mock('../use-projects', () => ({ useProjects: () => ({ projects: PROJECTS, loading: false }) }));

import { DaemonPortProvider } from '../runtime/daemon-port-context';
import { makeChatsRemoteAdapter } from '../runtime/chats-remote-adapter';
import { useThreadItems } from '../runtime/use-thread-items';
import { SessionLineageProvider, useSessionLineageValue } from '../SessionLineageContext';
import { SessionRow } from '../SessionRow';
import { useActiveIdentity } from '../use-active-identity';
import { listedThreadItemsToSessionItems } from '../view-model/task-chats';

const PORT = 31415;
const IDS = ['chat-a', 'chat-b', 'chat-c'];

function chat(id: string, patch: Partial<Chat> = {}): Chat {
  return {
    id,
    adapterId: 'claude',
    projectId: 'proj-a',
    title: id,
    status: 'active',
    displayStatus: 'idle',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    temporary: false,
    noProject: false,
    ...patch,
  } as Chat;
}

// Main-thread messages, driven by the test to emulate a streamed answer.
let messages: ThreadMessageLike[] = [];
const messageListeners = new Set<() => void>();
const messageStore = {
  subscribe: (listener: () => void) => {
    messageListeners.add(listener);
    return () => messageListeners.delete(listener);
  },
  get: () => messages,
};

const NO_MESSAGES: ThreadMessageLike[] = [];

/** Streams into `chat-a` (the main thread) only; the boot draft stays empty. */
const useStubThreadRuntime = (): AssistantRuntime => {
  const current = useSyncExternalStore(messageStore.subscribe, messageStore.get);
  const streams = useAuiState((s) => s.threadListItem.id === 'chat-a');
  return useExternalStoreRuntime<ThreadMessageLike>({
    isRunning: true,
    messages: streams ? current : NO_MESSAGES,
    convertMessage: (message) => message,
    onNew: async () => {},
  });
};

const shell = { identityRenders: 0, listRenders: 0 };
let aui: ReturnType<typeof useAui> | null = null;

/** Stands in for the shell's identity consumers (RuntimeBody's leaf, TitleBar, the surfaces). */
function IdentityProbe() {
  shell.identityRenders += 1;
  aui = useAui();
  useActiveIdentity();
  return null;
}

/** The sidebar's list data path, minus the windowing and the header chrome. */
function Rows() {
  shell.listRenders += 1;
  const threadItems = useThreadItems();
  const items = useStableList(useMemo(() => listedThreadItemsToSessionItems(threadItems), [threadItems]));
  const groups = useMemo(() => [{ items }], [items]);
  const lineage = useSessionLineageValue(items, groups);
  return (
    <SessionLineageProvider value={lineage}>
      {items.map((item) => (
        <SessionRow key={item.id} item={item} />
      ))}
    </SessionLineageProvider>
  );
}

const Harness: FC = () => {
  const adapter = useMemo(() => makeChatsRemoteAdapter(PORT), []);
  const runtime = useRemoteThreadListRuntime({ runtimeHook: useStubThreadRuntime, adapter });
  return (
    <DaemonPortProvider port={PORT}>
      <SidebarProvider>
        <AssistantRuntimeProvider runtime={runtime}>
          <IdentityProbe />
          <Rows />
        </AssistantRuntimeProvider>
      </SidebarProvider>
    </DaemonPortProvider>
  );
};

// The aui store flushes on a MessageChannel macrotask.
const flush = () => act(() => new Promise<void>((resolve) => setImmediate(resolve)));

function resetCounts() {
  rowRenders.clear();
  shell.identityRenders = 0;
  shell.listRenders = 0;
}

const rowCounts = () => Object.fromEntries(IDS.map((id) => [id, rowRenders.get(id) ?? 0]));

async function reloadWith(chats: Chat[]) {
  listChatsMock.mockResolvedValue(chats);
  await act(async () => {
    await aui!.threads.reload();
  });
  await flush();
}

async function mount() {
  listChatsMock.mockResolvedValue(IDS.map((id) => chat(id)));
  render(<Harness />);
  await waitFor(() => expect(rowRenders.get('chat-c')).toBeGreaterThan(0));
  await act(async () => {
    await aui!.threads.switchToThread('chat-a');
  });
  await flush();
  resetCounts();
}

beforeEach(() => {
  messages = [];
  aui = null;
  resetCounts();
  useUnreadStore.setState({ unread: new Set() });
});

describe('session list render isolation', () => {
  it('a cost/token-only chat.updated reload re-renders no row and no identity consumer', async () => {
    await mount();

    await reloadWith(IDS.map((id) => chat(id, id === 'chat-b' ? { totalCost: 1.25, totalTokensInput: 900 } : {})));

    expect(listChatsMock).toHaveBeenCalledTimes(2);
    expect(rowCounts()).toEqual({ 'chat-a': 0, 'chat-b': 0, 'chat-c': 0 });
    expect(shell.identityRenders).toBe(0);
    expect(shell.listRenders).toBe(0);
  });

  it('a background chat whose status moved re-renders its own row only', async () => {
    await mount();

    await reloadWith(IDS.map((id) => chat(id, id === 'chat-b' ? { displayStatus: 'working', isRunning: true } : {})));

    expect(rowCounts()['chat-b']).toBeGreaterThan(0);
    expect(rowCounts()['chat-a']).toBe(0);
    expect(rowCounts()['chat-c']).toBe(0);
    expect(shell.identityRenders).toBe(0);
  });

  it('a chat switch costs an uninvolved row no more than aui’s client bump', async () => {
    await mount();

    await act(async () => {
      await aui!.threads.switchToThread('chat-b');
    });
    await flush();

    expect(rowCounts()['chat-c']).toBeLessThanOrEqual(1);
  });

  it('an unread mark re-renders only the marked row', async () => {
    await mount();

    act(() => useUnreadStore.getState().markUnread('chat-c'));
    await flush();

    expect(rowCounts()).toEqual({ 'chat-a': 0, 'chat-b': 0, 'chat-c': 1 });
  });

  it('main-thread token churn re-renders no row and no identity consumer', async () => {
    await mount();
    messages = [{ id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'h' }] }];
    act(() => messageListeners.forEach((listener) => listener()));
    await flush();
    resetCounts();

    for (let i = 2; i <= 6; i++) {
      messages = [{ id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'h'.repeat(i) }] }];
      act(() => messageListeners.forEach((listener) => listener()));
      await flush();
    }

    expect(rowCounts()).toEqual({ 'chat-a': 0, 'chat-b': 0, 'chat-c': 0 });
    expect(shell.identityRenders).toBe(0);
    expect(shell.listRenders).toBe(0);
  });
});
