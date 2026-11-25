/**
 * useForkChat — forks via the daemon, opens the result in the workspace beside
 * the conversation (W9), and reports failure. `useAui` and the daemon port are
 * module-mocked.
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
vi.mock('@/lib/api/chats', () => ({ forkChat: (...args: unknown[]) => forkChatMock(...args) }));
vi.mock('@/lib/toast', () => ({ mfToast: { error: (...args: unknown[]) => toastError(...args) } }));
vi.mock('../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

import { useLayoutStore } from '@/store/layout';
import { useForkChat } from '../use-fork-chat';

beforeEach(() => {
  switchToThread.mockReset();
  reload.mockReset().mockResolvedValue(undefined);
  forkChatMock.mockReset();
  toastError.mockReset();
  useLayoutStore.setState({
    layout: { top: ['chat'], topFlex: {} },
    run: null,
    sessions: new Map(),
    activeSessionId: 'chat-parent',
  });
  mainThreadId = 'chat-parent';
});

const tabs = () => useLayoutStore.getState().run?.panes.flatMap((pane) => pane.tabs) ?? [];

describe('useForkChat', () => {
  it('opens the fork as a tab beside its parent, which stays the conversation', async () => {
    forkChatMock.mockResolvedValue({ id: 'chat-fork-1', title: 'Try it another way' });
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent'));

    expect(forkChatMock).toHaveBeenCalledWith(31415, 'chat-parent');
    expect(tabs()).toEqual([
      { id: 'chat-chat-fork-1', kind: 'chat', title: 'Try it another way', chatId: 'chat-fork-1', role: 'fork' },
    ]);
    expect(useLayoutStore.getState().layout.top).toEqual(['chat', 'workspace']);
    expect(switchToThread).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('opens it beside the conversation on screen when the parent is another session', async () => {
    mainThreadId = 'chat-current';
    useLayoutStore.setState({ activeSessionId: 'chat-current' });
    forkChatMock.mockResolvedValue({ id: 'chat-fork-1' });
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent'));

    expect(tabs().map((tab) => tab.chatId)).toEqual(['chat-fork-1']);
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('opens it in the chat column when only an unsent draft is in view', async () => {
    mainThreadId = '__LOCALID_1';
    forkChatMock.mockResolvedValue({ id: 'chat-fork-1' });
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent'));

    expect(tabs()).toEqual([]);
    expect(switchToThread).toHaveBeenCalledWith('chat-fork-1');
  });

  it('shows the daemon failure message as a toast and switches nothing on failure', async () => {
    forkChatMock.mockRejectedValue(new Error('Nothing to fork yet'));
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent'));

    expect(toastError).toHaveBeenCalledWith('Nothing to fork yet');
    expect(switchToThread).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(tabs()).toEqual([]);
  });

  it('sends fromMessageId and opens the fork', async () => {
    forkChatMock.mockResolvedValue({ id: 'chat-fork-2' });
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent', { fromMessageId: 'msg-2' }));

    expect(forkChatMock).toHaveBeenCalledWith(31415, 'chat-parent', { fromMessageId: 'msg-2' });
    expect(tabs().map((tab) => tab.chatId)).toEqual(['chat-fork-2']);
  });

  it('does not switch when a from-message fork fails', async () => {
    forkChatMock.mockRejectedValue(new Error('Nothing before this message to fork'));
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent', { fromMessageId: 'msg-1' }));

    expect(toastError).toHaveBeenCalledWith('Nothing before this message to fork');
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('falls back to a generic message for a non-Error rejection', async () => {
    forkChatMock.mockRejectedValue('boom');
    const { result } = renderHook(() => useForkChat());

    await act(() => result.current('chat-parent'));

    expect(toastError).toHaveBeenCalledWith('Fork failed');
  });
});
