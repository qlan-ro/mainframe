/**
 * ChatThread — transient "Compacting…" pill.
 *
 * While `state.compacting` is true the transcript tail shows a spinner pill
 * (chat-compacting-pill); when it flips false the pill unmounts (the persisted
 * "Context compacted" system message takes over via the normal message list).
 * Mocks mirror ChatThread.test.tsx: assistant-ui primitives + heavy children
 * become identifiable stubs; `useChatExtras` reads a tiny external store.
 */
import { act, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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
    useAuiState: (sel: (s: { thread: { isRunning: boolean; messages: unknown[] } }) => unknown) =>
      sel({ thread: { isRunning: false, messages: [{}] } }),
  };
});

// ── Heavy children → stubs ───────────────────────────────────────────────────
vi.mock('../../messages/bounded-messages', () => ({ boundedMessageComponents: {} }));
vi.mock('../../composer/Composer', () => ({ Composer: () => <div data-testid="composer-stub" /> }));
vi.mock('../../composer/WorktreeSwitchBanner', () => ({ WorktreeSwitchBanner: () => null }));
vi.mock('../../orchestration/AgentOutboxChip', () => ({ AgentOutboxChip: () => null }));
vi.mock('../ChatSelectionToolbar', () => ({ ChatSelectionToolbar: () => null }));
vi.mock('../../composer/edit/composer-edit-context', () => ({
  ComposerEditProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../gates/ChatGateMount', () => ({ ChatGateMount: () => <div data-testid="gate-mount-stub" /> }));
vi.mock('../DegradedChatCard', () => ({ DegradedChatCard: () => null }));
vi.mock('../use-rotating-phrase', () => ({ useRotatingPhrase: () => 'Thinking…' }));
vi.mock('@/features/skills/use-chat-skills', () => ({
  SkillsProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../find/FindBar', () => ({ FindBar: () => null }));
vi.mock('../../tools/register-cards', () => ({}));

// Extras state behind a tiny external store. The real hook is reactive: a flip
// re-renders the components that read it, not their (memoized) parents.
let extrasState = { compacting: true, loadState: { type: 'ready' }, runState: { type: 'idle' } };
const extrasListeners = new Set<() => void>();
function setCompacting(compacting: boolean): void {
  extrasState = { ...extrasState, compacting };
  extrasListeners.forEach((listener) => listener());
}
vi.mock('../../runtime/chat-extras', async () => {
  const { useSyncExternalStore } = await vi.importActual<typeof import('react')>('react');
  const subscribe = (listener: () => void) => {
    extrasListeners.add(listener);
    return () => extrasListeners.delete(listener);
  };
  return {
    useChatExtras: () => ({
      state: useSyncExternalStore(subscribe, () => extrasState),
      retry: () => Promise.resolve(),
    }),
  };
});

import { ChatThread } from '../ChatThread';

describe('ChatThread — transient "Compacting…" pill', () => {
  it('renders the pill with its label while compacting', () => {
    setCompacting(true);
    render(<ChatThread />);
    expect(screen.getByTestId('chat-compacting-pill')).toBeInTheDocument();
    expect(screen.getByText('Compacting…')).toBeInTheDocument();
  });

  it('unmounts the pill when compacting flips false', () => {
    setCompacting(true);
    render(<ChatThread />);
    expect(screen.getByTestId('chat-compacting-pill')).toBeInTheDocument();

    act(() => setCompacting(false));
    expect(screen.queryByTestId('chat-compacting-pill')).toBeNull();
  });

  it('renders the pill in the messages column, not the sticky footer', () => {
    setCompacting(true);
    render(<ChatThread />);
    const footer = screen.getByTestId('tp-viewport-footer');
    expect(within(footer).queryByTestId('chat-compacting-pill')).toBeNull();
    const messages = screen.getByTestId('tp-messages');
    const pill = screen.getByTestId('chat-compacting-pill');
    expect(messages.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
