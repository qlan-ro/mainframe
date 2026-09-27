/**
 * SideChatPanelHeader — collapse, close, and status (todo #344).
 *
 * Covers:
 *  - collapse calls setCollapsed(parentChatId, true);
 *  - close calls discard and, on success, unregisters the side-chat id;
 *  - a failed close leaves nothing crashed and shows an error toast (the
 *    panel itself stays mounted — SideChatHost only unmounts it once the
 *    parent's own sideChatId clears, which a failed discard never does);
 *  - the status dot reflects running/waiting from the shared controller.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const discardChat = vi.fn();
vi.mock('@/lib/api/chats', () => ({ discardChat: (...args: unknown[]) => discardChat(...args) }));

const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({ mfToast: { error: (...args: unknown[]) => toastError(...args) } }));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

let __permissions: Record<string, unknown> = {};
let __runState: { type: string } = { type: 'idle' };
vi.mock('../use-side-chat-controller', async () => {
  const actual = await vi.importActual<typeof import('../use-side-chat-controller')>('../use-side-chat-controller');
  return {
    ...actual,
    useOptionalControllerState: () => ({
      interactions: { permissions: __permissions },
      runState: __runState,
    }),
    isRunningFromState: (s: { runState: { type: string } }) => s.runState.type === 'running',
  };
});

import { SideChatPanelHeader } from '../SideChatPanelHeader';
import { unregisterSideChat } from '../side-chat-ids';

vi.mock('../side-chat-ids', () => ({ unregisterSideChat: vi.fn() }));
// The notice reads the real assistant-ui context (useChatExtras), which this
// header-focused suite doesn't set up — covered separately by SideChatNotice.
vi.mock('../SideChatNotice', () => ({ SideChatNotice: () => <div data-testid="notice-stub" /> }));

const fakeController = {} as never;

beforeEach(() => {
  discardChat.mockReset();
  toastError.mockReset();
  vi.mocked(unregisterSideChat).mockClear();
  __permissions = {};
  __runState = { type: 'idle' };
});

describe('SideChatPanelHeader — collapse', () => {
  it('collapses the panel for this parent on click', async () => {
    const { useSideChatCollapseStore } = await import('../side-chat-collapse-store');
    render(<SideChatPanelHeader parentChatId="parent-1" sideChatId="side-1" controller={fakeController} />);

    fireEvent.click(screen.getByTestId('side-chat-collapse-parent-1'));

    expect(useSideChatCollapseStore.getState().isCollapsed('parent-1')).toBe(true);
  });
});

describe('SideChatPanelHeader — close', () => {
  it('discards the side chat and unregisters its id on success', async () => {
    discardChat.mockResolvedValue(undefined);
    render(<SideChatPanelHeader parentChatId="parent-1" sideChatId="side-1" controller={fakeController} />);

    fireEvent.click(screen.getByTestId('side-chat-close-parent-1'));

    expect(discardChat).toHaveBeenCalledWith(31415, 'side-1');
    await waitFor(() => expect(unregisterSideChat).toHaveBeenCalledWith('side-1'));
  });

  it('shows an error toast and does not unregister on a failed discard', async () => {
    discardChat.mockRejectedValue(new Error('daemon unreachable'));
    render(<SideChatPanelHeader parentChatId="parent-1" sideChatId="side-1" controller={fakeController} />);

    fireEvent.click(screen.getByTestId('side-chat-close-parent-1'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('daemon unreachable'));
    expect(unregisterSideChat).not.toHaveBeenCalled();
    // The header itself is unaffected by a failed close — still on screen.
    expect(screen.getByTestId('side-chat-close-parent-1')).toBeInTheDocument();
  });
});

describe('SideChatPanelHeader — status', () => {
  it('shows a running dot while the side chat is running', () => {
    __runState = { type: 'running' };
    render(<SideChatPanelHeader parentChatId="parent-1" sideChatId="side-1" controller={fakeController} />);

    const dot = screen.getByTestId('side-chat-header-parent-1').querySelector('span[aria-hidden]');
    expect(dot).toHaveClass('animate-pulse');
  });

  it('shows a waiting dot while a gate is pending', () => {
    __permissions = { req1: { askedAt: 1 } };
    render(<SideChatPanelHeader parentChatId="parent-1" sideChatId="side-1" controller={fakeController} />);

    const dot = screen.getByTestId('side-chat-header-parent-1').querySelector('span[aria-hidden]');
    expect(dot).toHaveClass('animate-pulse');
  });

  it('shows an idle dot otherwise', () => {
    render(<SideChatPanelHeader parentChatId="parent-1" sideChatId="side-1" controller={fakeController} />);

    const dot = screen.getByTestId('side-chat-header-parent-1').querySelector('span[aria-hidden]');
    expect(dot).not.toHaveClass('animate-pulse');
  });
});
