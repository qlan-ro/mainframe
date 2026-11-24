// @vitest-environment jsdom

/**
 * A row catches up when the socket comes back. Events sent while it was down are
 * lost, so a gate that opened (or a run that ended) in that window reaches the
 * row only through a reload on reconnect — over the real thread-list runtime and
 * chats adapter, with only the REST layer and the socket stubbed.
 *
 * At boot the socket opens while the first load is running. That one connect does
 * not ask again; any other first connect does.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { useMemo, type FC } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssistantRuntimeProvider, useExternalStoreRuntime, useRemoteThreadListRuntime } from '@assistant-ui/react';
import type { AssistantRuntime, ThreadMessage } from '@assistant-ui/react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { SidebarProvider } from '@/components/ui/sidebar';

const { ws, listChatsMock } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    listChatsMock: vi.fn(),
    ws: {
      connected: true,
      listeners,
      onEvent: () => () => {},
      subscribeConnection: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
});

vi.mock('../../../../lib/daemon/ws-client', () => ({ daemonWs: ws }));
vi.mock('../../../../lib/host', () => ({ getHost: () => ({ notify: async () => {} }) }));
vi.mock('@/lib/api/chats', () => ({
  listChats: listChatsMock,
  getChat: vi.fn(),
  renameChat: vi.fn(),
  archiveChat: vi.fn(),
  discardChat: vi.fn(),
  unarchiveChat: vi.fn(),
}));

import { DaemonPortProvider } from '../../runtime/daemon-port-context';
import { makeChatsRemoteAdapter } from '../../runtime/chats-remote-adapter';
import { useThreadItems } from '../../runtime/use-thread-items';
import { SessionRow } from '../../SessionRow';
import { listedThreadItemsToSessionItems } from '../../view-model/task-chats';
import { useSessionListRouter } from '../use-session-list-router';

const PORT = 31415;

function chat(patch: Partial<Chat>): Chat {
  return {
    id: 'chat-a',
    adapterId: 'claude',
    projectId: 'proj-a',
    title: 'Alpha',
    status: 'active',
    displayStatus: 'working',
    isRunning: true,
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

const useStubThreadRuntime = (): AssistantRuntime =>
  useExternalStoreRuntime<ThreadMessage>({ isRunning: false, messages: [], onNew: async () => {} });

const Rows: FC = () => {
  useSessionListRouter();
  const threadItems = useThreadItems();
  const items = useMemo(() => listedThreadItemsToSessionItems(threadItems), [threadItems]);
  return items.map((item) => <SessionRow key={item.id} item={item} />);
};

const Harness: FC = () => {
  const adapter = useMemo(() => makeChatsRemoteAdapter(PORT), []);
  const runtime = useRemoteThreadListRuntime({ runtimeHook: useStubThreadRuntime, adapter });
  return (
    <DaemonPortProvider port={PORT}>
      <SidebarProvider>
        <AssistantRuntimeProvider runtime={runtime}>
          <Rows />
        </AssistantRuntimeProvider>
      </SidebarProvider>
    </DaemonPortProvider>
  );
};

function setConnected(connected: boolean) {
  act(() => {
    ws.connected = connected;
    for (const listener of ws.listeners) listener();
  });
}

const rowStatus = () => screen.getByTestId('sessions-row-status').getAttribute('data-status');

async function mountRunning() {
  listChatsMock.mockResolvedValue([chat({})]);
  render(<Harness />);
  await waitFor(() => expect(rowStatus()).toBe('running'));
}

beforeEach(() => {
  ws.connected = true;
  ws.listeners.clear();
  listChatsMock.mockReset();
});

it('shows a gate that opened while the socket was down', async () => {
  await mountRunning();

  setConnected(false);
  listChatsMock.mockResolvedValue([chat({ displayStatus: 'waiting' })]);
  expect(rowStatus()).toBe('running');

  setConnected(true);
  await waitFor(() => expect(rowStatus()).toBe('needs-you'));
});

it('stops the spinner of a run that ended with the daemon', async () => {
  await mountRunning();

  setConnected(false);
  listChatsMock.mockResolvedValue([chat({ displayStatus: 'idle', isRunning: false })]);
  setConnected(true);

  await waitFor(() => expect(rowStatus()).toBe('idle'));
});

it('asks once at boot, when the socket opens while the list is loading', async () => {
  ws.connected = false;
  let respond = (_chats: Chat[]) => {};
  listChatsMock.mockImplementationOnce(() => new Promise<Chat[]>((resolve) => (respond = resolve)));
  render(<Harness />);
  await waitFor(() => expect(listChatsMock).toHaveBeenCalledTimes(1));

  setConnected(true);
  await act(async () => respond([chat({})]));

  await waitFor(() => expect(rowStatus()).toBe('running'));
  expect(listChatsMock).toHaveBeenCalledTimes(1);

  listChatsMock.mockResolvedValue([chat({ displayStatus: 'waiting' })]);
  setConnected(false);
  setConnected(true);
  await waitFor(() => expect(rowStatus()).toBe('needs-you'));
});

it('asks again when the list had already loaded before the socket first opened', async () => {
  ws.connected = false;
  await mountRunning();

  listChatsMock.mockResolvedValue([chat({ displayStatus: 'waiting' })]);
  setConnected(true);

  await waitFor(() => expect(rowStatus()).toBe('needs-you'));
});

it('asks again when the boot load failed before the socket first opened', async () => {
  ws.connected = false;
  listChatsMock.mockRejectedValueOnce(new Error('daemon not up'));
  render(<Harness />);
  await waitFor(() => expect(listChatsMock).toHaveBeenCalledTimes(1));
  await act(async () => {});

  listChatsMock.mockResolvedValue([chat({})]);
  setConnected(true);

  await waitFor(() => expect(rowStatus()).toBe('running'));
});

it('asks again when the socket dropped before it first opened', async () => {
  ws.connected = false;
  let respond = (_chats: Chat[]) => {};
  listChatsMock.mockImplementationOnce(() => new Promise<Chat[]>((resolve) => (respond = resolve)));
  render(<Harness />);
  await waitFor(() => expect(listChatsMock).toHaveBeenCalledTimes(1));

  setConnected(false);
  listChatsMock.mockResolvedValue([chat({ displayStatus: 'waiting' })]);
  setConnected(true);
  await act(async () => respond([chat({})]));

  await waitFor(() => expect(rowStatus()).toBe('needs-you'));
});
