// @vitest-environment jsdom

/**
 * A row catches up when the socket comes back. Events sent while it was down are
 * lost, so a gate that opened (or a run that ended) in that window reaches the
 * row only through a reload on reconnect — over the real thread-list runtime and
 * chats adapter, with only the REST layer and the socket stubbed.
 *
 * At boot the socket opens while the first load is running. The answer to that
 * load can be older than the socket, so once it is in the list asks again, and a
 * failed second request leaves the first answer in place.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { useMemo, type FC } from 'react';
import { beforeEach, expect, it, vi, onTestFinished } from 'vitest';
import { AssistantRuntimeProvider, useExternalStoreRuntime, useRemoteThreadListRuntime } from '@assistant-ui/react';
import type { AssistantRuntime, ThreadMessage } from '@assistant-ui/react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { SidebarProvider } from '@/components/ui/sidebar';

const { ws, listChatsMock, chatExistsMock } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    listChatsMock: vi.fn(),
    chatExistsMock: vi.fn(),
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
  chatExists: chatExistsMock,
  renameChat: vi.fn(),
  archiveChat: vi.fn(),
  discardChat: vi.fn(),
  unarchiveChat: vi.fn(),
}));

import { getActiveDaemon, setActiveDaemon } from '@/lib/daemon/active-daemon';
import { useHeldQueue } from '@/features/chat/composer/queue/held-queue-store';
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

it('shows a gate that opened between the boot answer and the socket', async () => {
  ws.connected = false;
  let respond = (_chats: Chat[]) => {};
  listChatsMock.mockImplementationOnce(() => new Promise<Chat[]>((resolve) => (respond = resolve)));
  render(<Harness />);
  await waitFor(() => expect(listChatsMock).toHaveBeenCalledTimes(1));

  // The daemon built its first answer, then the gate opened, then the socket did.
  listChatsMock.mockResolvedValue([chat({ displayStatus: 'waiting' })]);
  setConnected(true);
  await act(async () => respond([chat({})]));

  await waitFor(() => expect(rowStatus()).toBe('needs-you'));
  expect(listChatsMock).toHaveBeenCalledTimes(2);
});

it('keeps the boot answer when asking again fails', async () => {
  ws.connected = false;
  let respond = (_chats: Chat[]) => {};
  listChatsMock.mockImplementationOnce(() => new Promise<Chat[]>((resolve) => (respond = resolve)));
  render(<Harness />);
  await waitFor(() => expect(listChatsMock).toHaveBeenCalledTimes(1));

  listChatsMock.mockRejectedValue(new Error('daemon went away'));
  setConnected(true);
  expect(listChatsMock).toHaveBeenCalledTimes(1);
  await act(async () => respond([chat({})]));

  await waitFor(() => expect(listChatsMock).toHaveBeenCalledTimes(2));
  expect(rowStatus()).toBe('running');
});

it('asks again once after boot, not after every answer', async () => {
  ws.connected = false;
  let respond = (_chats: Chat[]) => {};
  listChatsMock.mockImplementationOnce(() => new Promise<Chat[]>((resolve) => (respond = resolve)));
  render(<Harness />);
  await waitFor(() => expect(listChatsMock).toHaveBeenCalledTimes(1));

  listChatsMock.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return [chat({ displayStatus: 'waiting' })];
  });
  setConnected(true);
  await act(async () => respond([chat({})]));
  await waitFor(() => expect(rowStatus()).toBe('needs-you'));

  // Past the 200 ms window that would collapse a repeat.
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
  expect(listChatsMock).toHaveBeenCalledTimes(2);
});

it('shows the boot answer while asking again has no answer', async () => {
  ws.connected = false;
  let respond = (_chats: Chat[]) => {};
  listChatsMock.mockImplementationOnce(() => new Promise<Chat[]>((resolve) => (respond = resolve)));
  render(<Harness />);
  await waitFor(() => expect(listChatsMock).toHaveBeenCalledTimes(1));

  listChatsMock.mockImplementation(() => new Promise<Chat[]>(() => {}));
  setConnected(true);
  await act(async () => respond([chat({})]));

  await waitFor(() => expect(listChatsMock).toHaveBeenCalledTimes(2));
  expect(rowStatus()).toBe('running');
});

it('asks again when the boot load fails after the socket opened', async () => {
  ws.connected = false;
  let fail = (_error: Error) => {};
  listChatsMock.mockImplementationOnce(() => new Promise<Chat[]>((_, reject) => (fail = reject)));
  render(<Harness />);
  await waitFor(() => expect(listChatsMock).toHaveBeenCalledTimes(1));

  listChatsMock.mockResolvedValue([chat({})]);
  setConnected(true);
  await act(async () => fail(new Error('daemon still starting')));

  await waitFor(() => expect(rowStatus()).toBe('running'));
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

it('forgets what it held for a session removed while the socket was down', async () => {
  chatExistsMock.mockImplementation(async (chatId: string) => chatId !== 'removed');
  // A paired daemon: one on this machine is not asked (`useHeldQueuePrune`).
  const local = getActiveDaemon();
  setActiveDaemon({ ...local, id: 'paired', kind: 'remote' });
  onTestFinished(() => setActiveDaemon(local));
  await mountRunning();
  setConnected(false);
  useHeldQueue.getState().hold('removed', {
    messageId: 'm1',
    chatId: 'removed',
    uuid: 'u1',
    content: 'held',
    timestamp: '2026-11-24T10:00',
  });

  setConnected(true);

  await waitFor(() => expect(useHeldQueue.getState().byChat).toEqual({}));
});
