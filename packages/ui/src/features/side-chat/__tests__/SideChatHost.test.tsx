/**
 * SideChatHost — todo #344, UI rule 8.
 *
 * Covers:
 *  - renders nothing, and creates no controller, with no side chat;
 *  - renders SideChatPanel when the parent has a side chat and isn't collapsed;
 *  - collapse hides the panel but the controller stays loaded/live-subscribed
 *    regardless (rule 8) — collapsing never tears down the subscription;
 *  - a side chat removed from another client (sideChatId clears) makes the
 *    panel disappear with no error;
 *  - a pending gate expands the panel while the parent is on screen.
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let __chatConfig: { sideChatId?: string | null } | null = null;
vi.mock('@/features/chat/runtime/chat-extras', () => ({
  useChatExtras: () => (__chatConfig ? { state: { chatConfig: __chatConfig } } : undefined),
}));

const load = vi.fn(async () => undefined);
const unsubscribeLive = vi.fn();
const subscribeLive = vi.fn(() => unsubscribeLive);
let __permissions: Record<string, unknown> = {};
function makeController() {
  // A stable snapshot reference, frozen at creation time (matches the real
  // controller's contract: getState() returns the SAME object until the
  // reducer processes an event) — useSyncExternalStore requires this.
  const state = { interactions: { permissions: __permissions, queued: {} } };
  return {
    getState: () => state,
    subscribeState: () => () => undefined,
    subscribeLive,
    load,
  };
}
const controllers = new Map<string, ReturnType<typeof makeController>>();
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: {
    getOrCreate: (id: string) => {
      if (!controllers.has(id)) controllers.set(id, makeController());
      return controllers.get(id)!;
    },
  },
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

vi.mock('../SideChatPanel', () => ({
  SideChatPanel: ({ parentChatId, sideChatId }: { parentChatId: string; sideChatId: string }) => (
    <div data-testid={`side-chat-panel-${parentChatId}`} data-side-chat-id={sideChatId} />
  ),
}));

import { SideChatHost } from '../SideChatHost';
import { useSideChatCollapseStore } from '../side-chat-collapse-store';

beforeEach(() => {
  __chatConfig = null;
  __permissions = {};
  controllers.clear();
  load.mockClear();
  subscribeLive.mockClear();
  unsubscribeLive.mockClear();
  window.localStorage.clear();
  useSideChatCollapseStore.setState({ collapsedByParent: {} });
});

describe('SideChatHost — no side chat', () => {
  it('renders nothing and creates no controller', () => {
    __chatConfig = { sideChatId: null };
    const { container } = render(<SideChatHost parentChatId="parent-1" />);

    expect(container.firstChild).toBeNull();
    expect(controllers.size).toBe(0);
  });

  it('renders nothing with no parentChatId', () => {
    __chatConfig = { sideChatId: 'side-1' };
    const { container } = render(<SideChatHost parentChatId={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('SideChatHost — with a side chat', () => {
  it('mounts the panel and keeps the controller loaded + live-subscribed', () => {
    __chatConfig = { sideChatId: 'side-1' };
    render(<SideChatHost parentChatId="parent-1" />);

    expect(screen.getByTestId('side-chat-panel-parent-1')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    expect(subscribeLive).toHaveBeenCalledTimes(1);
  });

  it('collapse hides the panel but the controller stays subscribed (rule 8)', () => {
    __chatConfig = { sideChatId: 'side-1' };
    act(() => useSideChatCollapseStore.getState().setCollapsed('parent-1', true));
    render(<SideChatHost parentChatId="parent-1" />);

    expect(screen.queryByTestId('side-chat-panel-parent-1')).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    expect(subscribeLive).toHaveBeenCalledTimes(1);
    expect(unsubscribeLive).not.toHaveBeenCalled();
  });

  it('a side chat removed from another client makes the panel disappear with no error', () => {
    __chatConfig = { sideChatId: 'side-1' };
    const { rerender } = render(<SideChatHost parentChatId="parent-1" />);
    expect(screen.getByTestId('side-chat-panel-parent-1')).toBeInTheDocument();

    __chatConfig = { sideChatId: null };
    rerender(<SideChatHost parentChatId="parent-1" />);

    expect(screen.queryByTestId('side-chat-panel-parent-1')).toBeNull();
  });

  it('expands the panel when a gate is pending while the parent is on screen', () => {
    __chatConfig = { sideChatId: 'side-1' };
    act(() => useSideChatCollapseStore.getState().setCollapsed('parent-1', true));
    __permissions = { req1: { askedAt: 1 } };

    render(<SideChatHost parentChatId="parent-1" />);

    expect(useSideChatCollapseStore.getState().isCollapsed('parent-1')).toBe(false);
    expect(screen.getByTestId('side-chat-panel-parent-1')).toBeInTheDocument();
  });
});
