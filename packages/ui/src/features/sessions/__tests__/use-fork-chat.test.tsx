/**
 * useForkChat — forks via the daemon, opens the result in a split beside its
 * parent, and reports failure.
 * `useAui` and the daemon port are module-mocked; `switchToThread` is asserted
 * to fire without waiting on `reload()` first (the self-heal via
 * `adapter.fetch` documented on the hook). The split beside the parent is
 * only queued here — `useZonesReconciler` opens it once the fork is listed.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const switchToThread = vi.fn();
let mainThreadId: string | null = 'chat-parent';
const reload = vi.fn().mockResolvedValue(undefined);
const forkChatMock = vi.fn();
const toastError = vi.fn();

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({ threads: { switchToThread, reload, getState: () => ({ mainThreadId }) } }),
}));
vi.mock('@/lib/api/chats', () => ({ forkChat: (...args: unknown[]) => forkChatMock(...(args as [number, string])) }));
vi.mock('@/lib/toast', () => ({ mfToast: { error: (...args: unknown[]) => toastError(...args) } }));
vi.mock('../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

import { useZonesStore } from '@/features/chat/zones/zones-store';
import { useForkChat } from '../use-fork-chat';

beforeEach(() => {
  switchToThread.mockReset();
  reload.mockReset().mockResolvedValue(undefined);
  forkChatMock.mockReset();
  toastError.mockReset();
  useZonesStore.setState({ zones: null, focusedIndex: 0, pendingPair: null });
  mainThreadId = 'chat-parent';
});

describe('useForkChat', () => {
  it('forks the given chat, switches to the new one, and reloads the thread list', async () => {
    forkChatMock.mockResolvedValue({ id: 'chat-fork-1' });
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent'));

    expect(forkChatMock).toHaveBeenCalledWith(31415, 'chat-parent');
    expect(switchToThread).toHaveBeenCalledWith('chat-fork-1');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('queues a split pairing the fork beside its on-screen parent, parent on the left', async () => {
    forkChatMock.mockResolvedValue({ id: 'chat-fork-1' });
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent'));

    expect(useZonesStore.getState().pendingPair).toEqual(['chat-parent', 'chat-fork-1']);
  });

  it('pairs the fork with the chat in view when the parent is off screen', async () => {
    mainThreadId = 'chat-current';
    forkChatMock.mockResolvedValue({ id: 'chat-fork-1' });
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent'));

    expect(useZonesStore.getState().pendingPair).toEqual(['chat-current', 'chat-fork-1']);
    expect(switchToThread).toHaveBeenCalledWith('chat-fork-1');
  });

  it('opens the fork alone when only an unsent draft is in view', async () => {
    mainThreadId = '__LOCALID_1';
    forkChatMock.mockResolvedValue({ id: 'chat-fork-1' });
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent'));

    expect(useZonesStore.getState().pendingPair).toBeNull();
    expect(switchToThread).toHaveBeenCalledWith('chat-fork-1');
  });

  it('shows the daemon failure message as a toast and switches nothing on failure', async () => {
    forkChatMock.mockRejectedValue(new Error('Nothing to fork yet'));
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent'));

    expect(toastError).toHaveBeenCalledWith('Nothing to fork yet');
    expect(switchToThread).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(useZonesStore.getState().pendingPair).toBeNull();
  });

  it('falls back to a generic message for a non-Error rejection', async () => {
    forkChatMock.mockRejectedValue('boom');
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent'));

    expect(toastError).toHaveBeenCalledWith('Fork failed');
  });
});
