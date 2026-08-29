/**
 * ChatThread — placement test for the "thinking/working" indicator.
 *
 * The indicator must render INLINE after the last message (inside the scrolling
 * messages column), NOT pinned inside the sticky ViewportFooter above the
 * composer (#214). We mock the assistant-ui primitives + heavy children down to
 * identifiable stubs so we can assert the DOM region the indicator lands in.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';

// ── assistant-ui primitives → identifiable stub wrappers ─────────────────────
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
vi.mock('../../gates/ChatGateMount', () => ({ ChatGateMount: () => <div data-testid="gate-mount-stub" /> }));
vi.mock('../DegradedChatCard', () => ({ DegradedChatCard: () => null }));
vi.mock('../../runtime/chat-extras', () => ({ useChatExtras: () => undefined }));
vi.mock('../use-rotating-phrase', () => ({ useRotatingPhrase: () => 'Thinking…' }));
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

describe('ChatThread — thinking indicator placement (#214)', () => {
  it('renders the running indicator while a run is active', () => {
    render(<ChatThread />);
    expect(screen.getByTestId('chat-thread-running')).toBeInTheDocument();
  });

  it('places the running indicator OUTSIDE the sticky ViewportFooter', () => {
    render(<ChatThread />);
    const footer = screen.getByTestId('tp-viewport-footer');
    expect(within(footer).queryByTestId('chat-thread-running')).toBeNull();
  });

  it('places the running indicator immediately after the last message', () => {
    render(<ChatThread />);
    const messages = screen.getByTestId('tp-messages');
    const running = screen.getByTestId('chat-thread-running');
    // Same parent (the messages column) and the indicator follows the messages.
    expect(running.parentElement).toBe(messages.parentElement);
    expect(messages.compareDocumentPosition(running) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
