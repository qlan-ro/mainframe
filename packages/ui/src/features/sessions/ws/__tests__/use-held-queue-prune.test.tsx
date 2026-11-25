/**
 * A client that was offline when a project was removed got no `chat.ended`:
 * once it is connected again, what it held for a session that is gone goes too.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ws, getChat } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    getChat: vi.fn(),
    ws: {
      connected: false,
      listeners,
      subscribeConnection: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
});
vi.mock('../../../../lib/daemon/ws-client', () => ({ daemonWs: ws }));
vi.mock('@/lib/api/chats', () => ({ getChat }));

import { ApiRequestError } from '@/lib/api/http';
import { getActiveDaemon, setActiveDaemon } from '@/lib/daemon/active-daemon';
import { useHeldQueue } from '@/features/chat/composer/queue/held-queue-store';
import { useHeldQueuePrune } from '../use-held-queue-prune';

const LOCAL = getActiveDaemon();
const gone = new ApiRequestError('Chat not found', [], 404);
const hold = (chatId: string) =>
  useHeldQueue
    .getState()
    .hold(chatId, { messageId: `m-${chatId}`, chatId, uuid: 'u', content: 'held', timestamp: '2026-11-24T10:00:01Z' });
const heldChats = () => Object.keys(useHeldQueue.getState().byChat).sort();
async function connect(connected: boolean) {
  ws.connected = connected;
  await act(async () => ws.listeners.forEach((listener) => listener()));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useHeldQueue.setState({ byChat: {} });
  setActiveDaemon(LOCAL);
  ws.connected = false;
  ws.listeners.clear();
  getChat.mockImplementation(async (_port: number, chatId: string) => {
    if (chatId === 'gone') throw gone;
    return { id: chatId };
  });
});

describe('held rows of a session that is gone', () => {
  it('go when the client reconnects, and other sessions keep theirs', async () => {
    renderHook(() => useHeldQueuePrune(31415));
    hold('gone');
    hold('here');
    expect(getChat).not.toHaveBeenCalled();

    await connect(true);

    expect(heldChats()).toEqual(['here']);
    expect(localStorage.getItem('mf:held-queue')).not.toContain('m-gone');
    expect(getChat.mock.calls).toEqual(expect.arrayContaining([[31415, 'gone']]));
  });

  it('go when the app opens on a connected daemon', async () => {
    hold('gone');
    ws.connected = true;

    renderHook(() => useHeldQueuePrune(31415));
    await act(async () => {});

    expect(heldChats()).toEqual([]);
  });

  it('a disconnect asks nothing', async () => {
    hold('gone');
    renderHook(() => useHeldQueuePrune(31415));

    await connect(false);

    expect(getChat).not.toHaveBeenCalled();
    expect(heldChats()).toEqual(['gone']);
  });

  it.each([
    ['an unreachable daemon', new TypeError('Failed to fetch')],
    ['a daemon that failed', new ApiRequestError('boom', [], 500)],
  ])('stay after %s: nobody said the session is gone', async (_what, error) => {
    getChat.mockRejectedValue(error);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    hold('gone');
    renderHook(() => useHeldQueuePrune(31415));

    await connect(true);

    expect(heldChats()).toEqual(['gone']);
  });

  it('another daemon’s rows are not this one’s to judge', async () => {
    setActiveDaemon({ ...LOCAL, id: 'remote', kind: 'remote' });
    hold('gone');
    setActiveDaemon(LOCAL);
    renderHook(() => useHeldQueuePrune(31415));

    await connect(true);

    expect(getChat).not.toHaveBeenCalled();
    expect(heldChats()).toEqual(['gone']);
  });

  it('an answer that arrives after a switch to another daemon changes nothing', async () => {
    let answer = (_error: unknown) => {};
    getChat.mockImplementation(() => new Promise((_resolve, reject) => (answer = reject)));
    hold('gone');
    renderHook(() => useHeldQueuePrune(31415));
    await connect(true);

    setActiveDaemon({ ...LOCAL, id: 'remote', kind: 'remote' });
    await act(async () => answer(gone));

    expect(heldChats()).toEqual(['gone']);
  });
});
