/**
 * SideChatToggle — the parent header's affordance (todo #344, AC 19, rule 8).
 *
 * Covers:
 *  - hidden for a draft and for a non-regular (e.g. archived) thread;
 *  - opens a side chat when the parent has none;
 *  - shows and hides its workspace tab when one exists, keeping the side chat;
 *  - `data-side-chat-status` reflects none/idle/running/waiting.
 */
import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let __threadListItem: { id: string; status: string } | undefined = { id: 'parent-1', status: 'regular' };
let __custom: { sideChatId?: string | null } = {};
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: unknown) => unknown) =>
    sel({ threadListItem: __threadListItem, threads: { threadItems: [] } }),
}));
vi.mock('@/features/sessions/view-model/chat-to-thread-custom', () => ({
  activeSessionCustom: () => __custom,
}));

const openSideChat = vi.fn();
vi.mock('../use-open-side-chat', () => ({ useOpenSideChat: () => openSideChat }));

let __permissions: Record<string, unknown> = {};
let __runState: { type: string } = { type: 'idle' };
vi.mock('../use-side-chat-controller', () => ({
  useSideChatController: (id: string | null) => (id ? { id } : null),
  useOptionalControllerState: (c: { id: string } | null) =>
    c ? { interactions: { permissions: __permissions }, runState: __runState } : null,
  isRunningFromState: (s: { runState: { type: string } }) => s.runState.type === 'running',
  hasPendingGate: (s: { interactions: { permissions: Record<string, unknown> } }) =>
    Object.keys(s.interactions.permissions).length > 0,
}));

import { SideChatToggle } from '../SideChatToggle';
import { useLayoutStore } from '@/store/layout';

beforeEach(() => {
  __threadListItem = { id: 'parent-1', status: 'regular' };
  __custom = {};
  __permissions = {};
  __runState = { type: 'idle' };
  openSideChat.mockReset();
  window.localStorage.clear();
  useLayoutStore.setState({
    layout: { top: ['chat'], topFlex: {} },
    run: null,
    sessions: new Map(),
    activeSessionId: 'parent-1',
  });
});

describe('SideChatToggle — visibility (AC 19)', () => {
  it('renders nothing for a draft thread', () => {
    __threadListItem = { id: '__LOCALID_1', status: 'new' };
    const { container } = render(<SideChatToggle />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for an archived thread', () => {
    __threadListItem = { id: 'parent-1', status: 'archived' };
    const { container } = render(<SideChatToggle />);
    expect(container.firstChild).toBeNull();
  });

  it('renders for a regular thread', () => {
    render(<SideChatToggle />);
    expect(screen.getByTestId('side-chat-toggle-parent-1')).toBeInTheDocument();
  });
});

describe('SideChatToggle — opening', () => {
  it('opens a side chat when the parent has none', () => {
    render(<SideChatToggle />);

    fireEvent.click(screen.getByTestId('side-chat-toggle-parent-1'));

    expect(openSideChat).toHaveBeenCalledWith('parent-1', false);
    expect(screen.getByTestId('side-chat-toggle-parent-1')).toHaveAttribute('data-side-chat-status', 'none');
  });
});

describe('SideChatToggle — with an existing side chat', () => {
  const toggle = () => screen.getByTestId('side-chat-toggle-parent-1');
  const openTabs = () => useLayoutStore.getState().run?.panes.flatMap((p) => p.tabs.map((t) => t.chatId)) ?? [];

  it('shows its tab, then hides it again, and never opens another side chat', () => {
    __custom = { sideChatId: 'side-1' };
    render(<SideChatToggle />);

    fireEvent.click(toggle());
    expect(openTabs()).toEqual(['side-1']);
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle());
    expect(openTabs()).toEqual([]);
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(openSideChat).not.toHaveBeenCalled();
  });

  it('brings the tab forward rather than hiding it while another tab covers it', () => {
    __custom = { sideChatId: 'side-1' };
    render(<SideChatToggle />);
    fireEvent.click(toggle());
    act(() => void useLayoutStore.getState().addRunTab({ id: 'term', kind: 'terminal', title: 'zsh' }));
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle());

    expect(useLayoutStore.getState().run!.panes[0]!.active).toBe('chat-side-1');
  });

  it('shows a running status', () => {
    __custom = { sideChatId: 'side-1' };
    __runState = { type: 'running' };
    render(<SideChatToggle />);

    expect(screen.getByTestId('side-chat-toggle-parent-1')).toHaveAttribute('data-side-chat-status', 'running');
  });

  it('shows a waiting status while a gate is pending, even over running', () => {
    __custom = { sideChatId: 'side-1' };
    __runState = { type: 'running' };
    __permissions = { req1: { askedAt: 1 } };
    render(<SideChatToggle />);

    expect(screen.getByTestId('side-chat-toggle-parent-1')).toHaveAttribute('data-side-chat-status', 'waiting');
  });

  it('shows idle otherwise', () => {
    __custom = { sideChatId: 'side-1' };
    render(<SideChatToggle />);

    expect(screen.getByTestId('side-chat-toggle-parent-1')).toHaveAttribute('data-side-chat-status', 'idle');
  });
});
