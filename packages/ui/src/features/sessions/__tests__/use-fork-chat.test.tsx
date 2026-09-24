/**
 * useForkChat — forks via the daemon, opens the result, and reports failure.
 * `useAui` and the daemon port are module-mocked; `switchToThread` is asserted
 * to fire without waiting on `reload()` first (the self-heal via
 * `adapter.fetch` documented on the hook).
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const switchToThread = vi.fn();
const reload = vi.fn().mockResolvedValue(undefined);
const forkChatMock = vi.fn();
const toastError = vi.fn();

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({ threads: { switchToThread, reload } }),
}));
vi.mock('@/lib/api/chats', () => ({ forkChat: (...args: unknown[]) => forkChatMock(...(args as [number, string])) }));
vi.mock('@/lib/toast', () => ({ mfToast: { error: (...args: unknown[]) => toastError(...args) } }));
vi.mock('../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

import { useForkChat } from '../use-fork-chat';

beforeEach(() => {
  switchToThread.mockReset();
  reload.mockReset().mockResolvedValue(undefined);
  forkChatMock.mockReset();
  toastError.mockReset();
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

  it('shows the daemon failure message as a toast and switches nothing on failure', async () => {
    forkChatMock.mockRejectedValue(new Error('Nothing to fork yet'));
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent'));

    expect(toastError).toHaveBeenCalledWith('Nothing to fork yet');
    expect(switchToThread).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('falls back to a generic message for a non-Error rejection', async () => {
    forkChatMock.mockRejectedValue('boom');
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent'));

    expect(toastError).toHaveBeenCalledWith('Fork failed');
  });
});
