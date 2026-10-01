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
 *  - a pending gate expands the panel while the parent is on screen;
 *  - the controller is marked active while this host is mounted, and
 *    inactive again once it unmounts (todo #344 QA fix, AC 11) — the facade
 *    plane only attaches/reactivates while active, so without this the
 *    transcript never populates, live or on a switch-back.
 */
import { useEffect } from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let __chatConfig: { sideChatId?: string | null } | null = null;
vi.mock('@/features/chat/runtime/chat-extras', () => ({
  useChatExtras: () => (__chatConfig ? { state: { chatConfig: __chatConfig } } : undefined),
}));

const load = vi.fn(async () => undefined);
const unsubscribeLive = vi.fn();
const subscribeLive = vi.fn(() => unsubscribeLive);
const setActive = vi.fn();
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
    setActive,
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
  SideChatPanel: ({
    parentChatId,
    sideChatId,
    placement,
  }: {
    parentChatId: string;
    sideChatId: string;
    placement: string;
  }) => (
    <div data-testid={`side-chat-panel-${parentChatId}`} data-side-chat-id={sideChatId} data-placement={placement} />
  ),
}));

let __columnWidth: number | null = 1200;
vi.mock('@/features/shared/use-measured-width', () => ({
  useMeasuredWidth: () => [__columnWidth, () => undefined],
}));

const noopRef = () => undefined;
let threadMounts = 0;
function Thread() {
  useEffect(() => {
    threadMounts += 1;
  }, []);
  return <div data-testid="parent-thread" />;
}

import { SideChatHost } from '../SideChatHost';
import { useSideChatCollapseStore } from '../side-chat-collapse-store';

beforeEach(() => {
  __chatConfig = null;
  __permissions = {};
  controllers.clear();
  load.mockClear();
  subscribeLive.mockClear();
  unsubscribeLive.mockClear();
  setActive.mockClear();
  __columnWidth = 1200;
  threadMounts = 0;
  window.localStorage.clear();
  useSideChatCollapseStore.setState({ collapsedByParent: {} });
});

describe('SideChatHost — no side chat', () => {
  it('renders only the parent thread and creates no controller', () => {
    __chatConfig = { sideChatId: null };
    render(
      <SideChatHost parentChatId="parent-1" threadRef={noopRef}>
        <Thread />
      </SideChatHost>,
    );

    expect(screen.getByTestId('parent-thread')).toBeInTheDocument();
    expect(screen.queryByTestId('side-chat-panel-parent-1')).toBeNull();
    expect(controllers.size).toBe(0);
  });

  it('renders no panel with no parentChatId', () => {
    __chatConfig = { sideChatId: 'side-1' };
    render(
      <SideChatHost parentChatId={null} threadRef={noopRef}>
        <Thread />
      </SideChatHost>,
    );
    expect(screen.getByTestId('parent-thread')).toBeInTheDocument();
    expect(screen.queryByTestId('side-chat-panel-parent-1')).toBeNull();
  });
});

describe('SideChatHost — with a side chat', () => {
  it('mounts the panel and keeps the controller loaded + live-subscribed + active', () => {
    __chatConfig = { sideChatId: 'side-1' };
    render(
      <SideChatHost parentChatId="parent-1" threadRef={noopRef}>
        <Thread />
      </SideChatHost>,
    );

    expect(screen.getByTestId('side-chat-panel-parent-1')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    expect(subscribeLive).toHaveBeenCalledTimes(1);
    expect(setActive).toHaveBeenCalledWith(true);
    expect(setActive).not.toHaveBeenCalledWith(false);
  });

  it('deactivates the controller when the host unmounts, and reactivates on remount (todo #344, AC 11)', () => {
    __chatConfig = { sideChatId: 'side-1' };
    const { unmount, rerender } = render(
      <SideChatHost parentChatId="parent-1" threadRef={noopRef}>
        <Thread />
      </SideChatHost>,
    );
    expect(setActive).toHaveBeenLastCalledWith(true);

    // Switching away: the parent no longer resolves this side chat (a
    // different session is on screen) — the controller effect tears down.
    __chatConfig = { sideChatId: null };
    rerender(
      <SideChatHost parentChatId="parent-1" threadRef={noopRef}>
        <Thread />
      </SideChatHost>,
    );
    expect(setActive).toHaveBeenLastCalledWith(false);

    // Switching back: the same side chat resolves again — reactivate, not a
    // fresh attach from scratch (the plane itself decides full-replay vs.
    // cursor-resume; this host just needs to flip active back on).
    __chatConfig = { sideChatId: 'side-1' };
    rerender(
      <SideChatHost parentChatId="parent-1" threadRef={noopRef}>
        <Thread />
      </SideChatHost>,
    );
    expect(setActive).toHaveBeenLastCalledWith(true);

    unmount();
    expect(setActive).toHaveBeenLastCalledWith(false);
  });

  it('collapse hides the panel but the controller stays subscribed (rule 8)', () => {
    __chatConfig = { sideChatId: 'side-1' };
    act(() => useSideChatCollapseStore.getState().setCollapsed('parent-1', true));
    render(
      <SideChatHost parentChatId="parent-1" threadRef={noopRef}>
        <Thread />
      </SideChatHost>,
    );

    expect(screen.queryByTestId('side-chat-panel-parent-1')).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    expect(subscribeLive).toHaveBeenCalledTimes(1);
    expect(unsubscribeLive).not.toHaveBeenCalled();
    expect(setActive).toHaveBeenCalledWith(true);
    expect(setActive).not.toHaveBeenCalledWith(false);
  });

  it('a side chat removed from another client makes the panel disappear with no error', () => {
    __chatConfig = { sideChatId: 'side-1' };
    const { rerender } = render(
      <SideChatHost parentChatId="parent-1" threadRef={noopRef}>
        <Thread />
      </SideChatHost>,
    );
    expect(screen.getByTestId('side-chat-panel-parent-1')).toBeInTheDocument();

    __chatConfig = { sideChatId: null };
    rerender(
      <SideChatHost parentChatId="parent-1" threadRef={noopRef}>
        <Thread />
      </SideChatHost>,
    );

    expect(screen.queryByTestId('side-chat-panel-parent-1')).toBeNull();
  });

  it('expands the panel when a gate is pending while the parent is on screen', () => {
    __chatConfig = { sideChatId: 'side-1' };
    act(() => useSideChatCollapseStore.getState().setCollapsed('parent-1', true));
    __permissions = { req1: { askedAt: 1 } };

    render(
      <SideChatHost parentChatId="parent-1" threadRef={noopRef}>
        <Thread />
      </SideChatHost>,
    );

    expect(useSideChatCollapseStore.getState().isCollapsed('parent-1')).toBe(false);
    expect(screen.getByTestId('side-chat-panel-parent-1')).toBeInTheDocument();
  });
});

describe('SideChatHost — placement', () => {
  it('puts the panel beside the thread, behind a divider, when the column fits both', () => {
    __chatConfig = { sideChatId: 'side-1' };
    render(
      <SideChatHost parentChatId="parent-1" threadRef={noopRef}>
        <Thread />
      </SideChatHost>,
    );

    expect(screen.getByTestId('side-chat-panel-parent-1')).toHaveAttribute('data-placement', 'beside');
    expect(screen.getByTestId('side-chat-divider-parent-1')).toBeInTheDocument();
  });

  it('docks the panel below the thread, with no divider, when the column is too narrow', () => {
    __chatConfig = { sideChatId: 'side-1' };
    __columnWidth = 700;
    render(
      <SideChatHost parentChatId="parent-1" threadRef={noopRef}>
        <Thread />
      </SideChatHost>,
    );

    expect(screen.getByTestId('side-chat-panel-parent-1')).toHaveAttribute('data-placement', 'below');
    expect(screen.queryByTestId('side-chat-divider-parent-1')).toBeNull();
  });

  it('keeps the parent thread mounted across placement changes and panel open/close', () => {
    __chatConfig = { sideChatId: null };
    const ui = (
      <SideChatHost parentChatId="parent-1" threadRef={noopRef}>
        <Thread />
      </SideChatHost>
    );
    const { rerender } = render(ui);

    __chatConfig = { sideChatId: 'side-1' };
    rerender(ui);
    __columnWidth = 700;
    rerender(ui);
    act(() => useSideChatCollapseStore.getState().setCollapsed('parent-1', true));

    expect(threadMounts).toBe(1);
  });
});

describe('SideChatHost — the parent keeps its own session rail', () => {
  it("hands threadRef the parent's thread column, which excludes the side chat", () => {
    __chatConfig = { sideChatId: 'side-1' };
    let column: HTMLElement | null = null;
    render(
      <SideChatHost parentChatId="parent-1" threadRef={(el) => (column = el)}>
        <Thread />
      </SideChatHost>,
    );

    expect(column).not.toBeNull();
    expect(column!.contains(screen.getByTestId('parent-thread'))).toBe(true);
    expect(column!.contains(screen.getByTestId('side-chat-panel-parent-1'))).toBe(false);
  });
});
