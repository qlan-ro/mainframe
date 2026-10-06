/**
 * ChatThread — placement test for the "Working" status line.
 *
 * D18 reverses #214: the indicator now renders INSIDE the sticky
 * `ThreadPrimitive.ViewportFooter`, inside `chat-thread-footer`, above the
 * gate slot and the composer — the one live timer, on the status line, not
 * inline in the scrolling transcript. We mock the assistant-ui primitives +
 * heavy children down to identifiable stubs so we can assert the DOM region
 * the indicator lands in.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';

// ── assistant-ui primitives → identifiable stub wrappers ─────────────────────
vi.mock('../ProgressiveMessages', () => ({ ProgressiveMessages: () => <div data-testid="tp-messages" /> }));
vi.mock('@assistant-ui/react', () => {
  return {
    ThreadPrimitive: {
      Root: ({ children }: { children?: ReactNode }) => <div data-testid="tp-root">{children}</div>,
      Viewport: ({ children }: { children?: ReactNode }) => <div data-testid="tp-viewport">{children}</div>,
      ViewportFooter: ({ children }: { children?: ReactNode }) => (
        <div data-testid="tp-viewport-footer">{children}</div>
      ),
      ScrollToBottom: ({ children }: { children?: ReactNode }) => <>{children}</>,
      Messages: () => <div data-testid="tp-messages" />,
    },
    // `asChild` semantics aren't exercised here — Button carries its own
    // testid, the wrapper just needs to not swallow its child.
    ComposerPrimitive: {
      Cancel: ({ children }: { children?: ReactNode }) => <>{children}</>,
    },
    // isRunning selector → true; messages.length selector → 1.
    useAuiState: (sel: (s: { thread: { isRunning: boolean; messages: unknown[] } }) => unknown) =>
      sel({ thread: { isRunning: true, messages: [{}] } }),
  };
});

// ── Heavy children → stubs ───────────────────────────────────────────────────
vi.mock('../../messages/bounded-messages', () => ({ boundedMessageComponents: {} }));
vi.mock('../../composer/Composer', () => ({ Composer: () => <div data-testid="composer-stub" /> }));
vi.mock('../../composer/WorktreeSwitchBanner', () => ({ WorktreeSwitchBanner: () => null }));
vi.mock('../ChatSelectionToolbar', () => ({ ChatSelectionToolbar: () => null }));
vi.mock('../../composer/edit/composer-edit-context', () => ({
  ComposerEditProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../gates/ChatGateMount', () => ({ ChatGateMount: () => <div data-testid="chat-thread-gate-slot" /> }));
vi.mock('../DegradedChatCard', () => ({ DegradedChatCard: () => null }));
vi.mock('../../runtime/chat-extras', () => ({ useChatExtras: () => undefined }));
vi.mock('@/features/skills/use-chat-skills', () => ({
  SkillsProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../find/FindBar', () => ({ FindBar: () => null }));
vi.mock('../../tools/register-cards', () => ({}));

// jsdom reports a Linux-ish platform, so `mod` would resolve to Ctrl and the ⌘F
// case below would miss. The dispatcher reads this once at mount.
vi.mock('@/features/shortcuts/platform', () => ({ isMacPlatform: () => true }));

import { ChatThread } from '../ChatThread';
import { useFindInChatStore } from '../../find/find-in-chat-store';
import { useShortcutDispatcher } from '@/features/shortcuts/use-shortcut-dispatcher';

describe('ChatThread — status-line placement (D18 reverses #214)', () => {
  it('renders the running indicator while a run is active', () => {
    render(<ChatThread />);
    expect(screen.getByTestId('chat-thread-running')).toBeInTheDocument();
  });

  it('D18: places the running indicator INSIDE the sticky ViewportFooter, not inline in the transcript', () => {
    render(<ChatThread />);
    const footer = screen.getByTestId('tp-viewport-footer');
    expect(within(footer).getByTestId('chat-thread-running')).toBeInTheDocument();
    // ...and not beside the messages column, which is the OLD (#214) placement.
    const messages = screen.getByTestId('tp-messages');
    expect(within(footer).queryByTestId('tp-messages')).toBeNull();
    expect(messages.parentElement).not.toBe(screen.getByTestId('chat-thread-running').parentElement);
  });

  it('D18: places the running indicator above the gate slot, inside chat-thread-footer', () => {
    render(<ChatThread />);
    const footer = screen.getByTestId('chat-thread-footer');
    const running = within(footer).getByTestId('chat-thread-running');
    const gateSlot = within(footer).getByTestId('chat-thread-gate-slot');
    expect(running.compareDocumentPosition(gateSlot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('carries the fixed "Working" text and a ghost Stop button, not a rotating phrase', () => {
    render(<ChatThread />);
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Working');
    expect(screen.getByTestId('chat-composer-cancel')).toBeInTheDocument();
  });
});

describe('ChatThread — running indicator elapsed readout', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows no elapsed readout during the first second of a run', () => {
    render(<ChatThread />);
    expect(screen.queryByTestId('chat-thread-running-elapsed')).toBeNull();
  });

  it('reveals the elapsed readout once the run passes a second, and keeps it ticking', () => {
    render(<ChatThread />);

    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('chat-thread-running-elapsed')).toHaveTextContent('1s');

    act(() => void vi.advanceTimersByTime(64_000));
    expect(screen.getByTestId('chat-thread-running-elapsed')).toHaveTextContent('1m 05s');
  });
});

/**
 * ⌘F is a registry entry now, so the thread registers the ACTION and the app's
 * one dispatcher delivers the chord. The chord stays inert while no thread is
 * mounted, which is what keeps Find chat-scoped.
 */
describe('ChatThread — the ⌘F Find registration', () => {
  function Dispatcher() {
    useShortcutDispatcher();
    return null;
  }

  beforeEach(() => {
    useFindInChatStore.getState().close();
  });

  it('opens the Find bar on ⌘F while the thread is mounted', () => {
    render(
      <>
        <Dispatcher />
        <ChatThread />
      </>,
    );

    fireEvent.keyDown(window, { key: 'f', code: 'KeyF', metaKey: true });

    expect(useFindInChatStore.getState().isOpen).toBe(true);
  });

  it('leaves ⌘F inert with no thread mounted — Find belongs to the chat surface', () => {
    render(<Dispatcher />);

    fireEvent.keyDown(window, { key: 'f', code: 'KeyF', metaKey: true });

    expect(useFindInChatStore.getState().isOpen).toBe(false);
  });
});
