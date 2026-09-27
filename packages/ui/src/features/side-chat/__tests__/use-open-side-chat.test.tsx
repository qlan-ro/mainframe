/**
 * useOpenSideChat — activates the parent when it's off screen, opens (or
 * reveals) the side chat, registers the id, and expands the panel (todo #344).
 * `useAui` and the daemon port are module-mocked, mirroring use-fork-chat.test.tsx.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const switchToThread = vi.fn();
const getState = vi.fn();
const openSideChatMock = vi.fn();
const toastError = vi.fn();

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({ threads: { switchToThread, getState } }),
}));
vi.mock('@/lib/api/chats', () => ({
  openSideChat: (...args: unknown[]) => openSideChatMock(...(args as [number, string])),
}));
vi.mock('@/lib/toast', () => ({ mfToast: { error: (...args: unknown[]) => toastError(...args) } }));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

import { useOpenSideChat } from '../use-open-side-chat';
import { isRegisteredSideChatId, __resetSideChatRegistryForTests } from '../side-chat-ids';
import { useSideChatCollapseStore } from '../side-chat-collapse-store';

beforeEach(() => {
  switchToThread.mockReset();
  getState.mockReset().mockReturnValue({ mainThreadId: 'chat-parent' });
  openSideChatMock.mockReset();
  toastError.mockReset();
  __resetSideChatRegistryForTests();
  window.localStorage.clear();
  useSideChatCollapseStore.setState({ collapsedByParent: {} });
});

describe('useOpenSideChat — parent already on screen', () => {
  it('does not switch threads, opens the side chat, registers it, and expands', async () => {
    openSideChatMock.mockResolvedValue({ id: 'chat-side-1' });
    const { result } = renderHook(() => useOpenSideChat());

    await act(() => result.current('chat-parent'));

    expect(switchToThread).not.toHaveBeenCalled();
    expect(openSideChatMock).toHaveBeenCalledWith(31415, 'chat-parent');
    expect(isRegisteredSideChatId('chat-side-1')).toBe(true);
    expect(useSideChatCollapseStore.getState().isCollapsed('chat-parent')).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('useOpenSideChat — parent off screen', () => {
  it('activates the parent BEFORE opening the side chat', async () => {
    getState.mockReturnValue({ mainThreadId: 'chat-other' });
    openSideChatMock.mockResolvedValue({ id: 'chat-side-1' });
    const { result } = renderHook(() => useOpenSideChat());

    await act(() => result.current('chat-parent'));

    expect(switchToThread).toHaveBeenCalledWith('chat-parent');
    expect(openSideChatMock).toHaveBeenCalledWith(31415, 'chat-parent');
  });
});

describe('useOpenSideChat — daemon failure', () => {
  it('shows the daemon failure message as a toast and registers nothing', async () => {
    openSideChatMock.mockRejectedValue(new Error('Parent is archived'));
    const { result } = renderHook(() => useOpenSideChat());

    await act(() => result.current('chat-parent'));

    expect(toastError).toHaveBeenCalledWith('Parent is archived');
  });

  it('falls back to a generic message for a non-Error rejection', async () => {
    openSideChatMock.mockRejectedValue('boom');
    const { result } = renderHook(() => useOpenSideChat());

    await act(() => result.current('chat-parent'));

    expect(toastError).toHaveBeenCalledWith('Could not open side chat');
  });
});
