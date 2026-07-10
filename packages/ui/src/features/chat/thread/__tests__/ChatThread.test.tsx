/**
 * ChatThread — placement test for the "thinking/working" indicator.
 *
 * The indicator must render INLINE after the last message (inside the scrolling
 * messages column), NOT pinned inside the sticky ViewportFooter above the
 * composer (#214). We mock the assistant-ui primitives + heavy children down to
 * identifiable stubs so we can assert the DOM region the indicator lands in.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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
vi.mock('../../composer/BackgroundActivityBar', () => ({ BackgroundActivityBar: () => null }));
vi.mock('@/components/ui/assistant-ui/quote', () => ({ SelectionToolbar: () => null }));
vi.mock('../../composer/edit/composer-edit-context', () => ({
  ComposerEditProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../gates/ChatGateMount', () => ({ ChatGateMount: () => <div data-testid="gate-mount-stub" /> }));
vi.mock('../DegradedChatCard', () => ({ DegradedChatCard: () => null }));
vi.mock('../../runtime/use-chat-thread-runtime', () => ({ useChatExtras: () => undefined }));
vi.mock('../use-rotating-phrase', () => ({ useRotatingPhrase: () => 'Thinking…' }));
vi.mock('@/features/skills/use-chat-skills', () => ({
  SkillsProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../find/FindBar', () => ({ FindBar: () => null }));
vi.mock('../../find/use-find-hotkey', () => ({ useFindHotkey: () => {} }));
vi.mock('../../tools/register-cards', () => ({}));

import { ChatThread } from '../ChatThread';

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
