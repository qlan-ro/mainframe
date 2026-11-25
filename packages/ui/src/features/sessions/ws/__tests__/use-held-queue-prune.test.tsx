/**
 * A client that was offline when a project was removed got no `chat.ended`:
 * once it is connected again, what it held for a session that is gone goes too.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ws, chatExists } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    chatExists: vi.fn(),
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
vi.mock('@/lib/api/chats', () => ({ chatExists }));

import { ApiRequestError } from '@/lib/api/http';
import { getActiveDaemon, setActiveDaemon } from '@/lib/daemon/active-daemon';
import { useHeldQueue } from '@/features/chat/composer/queue/held-queue-store';
import { useHeldQueuePrune } from '../use-held-queue-prune';

const LOCAL = getActiveDaemon();
const PAIRED = { ...LOCAL, id: 'paired', kind: 'remote' as const };
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
  setActiveDaemon(PAIRED);
  ws.connected = false;
  ws.listeners.clear();
  chatExists.mockImplementation(async (chatId: string) => chatId !== 'gone');
});

describe('held rows of a session that is gone', () => {
  it('go when the client reconnects, and other sessions keep theirs', async () => {
    renderHook(() => useHeldQueuePrune());
    hold('gone');
    hold('here');
    expect(chatExists).not.toHaveBeenCalled();

    await connect(true);

    expect(heldChats()).toEqual(['here']);
    expect(localStorage.getItem('mf:held-queue')).not.toContain('m-gone');
    expect(chatExists.mock.calls).toEqual([['gone'], ['here']]);
  });

  it('go when the app opens on a connected daemon', async () => {
    hold('gone');
    ws.connected = true;

    renderHook(() => useHeldQueuePrune());
    await act(async () => {});

    expect(heldChats()).toEqual([]);
  });

  it('a disconnect asks nothing', async () => {
    hold('gone');
    renderHook(() => useHeldQueuePrune());

    await connect(false);

    expect(chatExists).not.toHaveBeenCalled();
    expect(heldChats()).toEqual(['gone']);
  });

  it.each([
    ['an unreachable daemon', new TypeError('Failed to fetch')],
    ['a daemon that failed', new ApiRequestError('boom', [], 500)],
  ])('stay after %s: nobody said the session is gone', async (_what, error) => {
    chatExists.mockRejectedValue(error);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    hold('gone');
    renderHook(() => useHeldQueuePrune());

    await connect(true);

    expect(heldChats()).toEqual(['gone']);
  });

  it('another daemon’s rows are not this one’s to judge', async () => {
    setActiveDaemon({ ...PAIRED, id: 'another' });
    hold('gone');
    setActiveDaemon(PAIRED);
    renderHook(() => useHeldQueuePrune());

    await connect(true);

    expect(chatExists).not.toHaveBeenCalled();
    expect(heldChats()).toEqual(['gone']);
  });

  it('an answer that arrives after a switch to another daemon changes nothing', async () => {
    let answer = (_exists: boolean) => {};
    chatExists.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    hold('gone');
    renderHook(() => useHeldQueuePrune());
    await connect(true);

    setActiveDaemon({ ...PAIRED, id: 'another' });
    await act(async () => answer(false));

    expect(heldChats()).toEqual(['gone']);
  });

  it('stay where the daemon is on this machine: another data directory answers as the same one', async () => {
    setActiveDaemon(LOCAL);
    hold('gone');
    renderHook(() => useHeldQueuePrune());

    await connect(true);

    expect(chatExists).not.toHaveBeenCalled();
    expect(heldChats()).toEqual(['gone']);
  });
});
