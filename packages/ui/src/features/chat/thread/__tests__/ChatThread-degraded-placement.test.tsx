/**
 * ChatThread — degraded-card placement in the sticky footer.
 *
 * The recovery card is part of the footer input slot: a missing working
 * directory replaces the composer, while transcript-only degradation keeps the
 * composer available. Heavy children and assistant-ui primitives are stubbed;
 * DegradedChatCard stays real so placement and composer absence are observable.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode, HTMLAttributes } from 'react';
import type { Chat } from '@qlan-ro/mainframe-types';

const testState = vi.hoisted(() => ({
  extrasState: {
    compacting: false,
    loadState: { type: 'ready' as const },
    chatConfig: null as Partial<Chat> | null,
  },
}));

vi.mock('@assistant-ui/react', () => {
  type DivProps = HTMLAttributes<HTMLDivElement> & { children?: ReactNode };
  return {
    ThreadPrimitive: {
      Root: ({ children, ...props }: DivProps) => <div {...props}>{children}</div>,
      Viewport: ({ children, ...props }: DivProps) => <div {...props}>{children}</div>,
      ViewportFooter: ({ children, ...props }: DivProps) => (
        <div data-testid="tp-viewport-footer" {...props}>
          {children}
        </div>
      ),
      ScrollToBottom: ({ children }: { children?: ReactNode }) => <>{children}</>,
      Messages: () => <div data-testid="tp-messages" />,
    },
    useAuiState: (sel: (s: { thread: { isRunning: boolean; messages: unknown[] } }) => unknown) =>
      sel({ thread: { isRunning: false, messages: [{}] } }),
  };
});

vi.mock('../../messages/bounded-messages', () => ({ boundedMessageComponents: {} }));
vi.mock('../../composer/Composer', () => ({ Composer: () => <div data-testid="chat-composer" /> }));
vi.mock('../../composer/WorktreeSwitchBanner', () => ({ WorktreeSwitchBanner: () => null }));
vi.mock('../ChatSelectionToolbar', () => ({ ChatSelectionToolbar: () => null }));
vi.mock('../../composer/edit/composer-edit-context', () => ({
  ComposerEditProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../gates/ChatGateMount', () => ({ ChatGateMount: () => <div data-testid="gate-mount-stub" /> }));
vi.mock('../use-rotating-phrase', () => ({ useRotatingPhrase: () => 'Thinking…' }));
vi.mock('@/features/skills/use-chat-skills', () => ({
  SkillsProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../find/FindBar', () => ({ FindBar: () => null }));
vi.mock('../../tools/register-cards', () => ({}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/lib/api/chats', () => ({
  continueChatHere: vi.fn().mockResolvedValue(undefined),
  recreateChatWorktree: vi.fn().mockResolvedValue(undefined),
  continueChatInProjectRoot: vi.fn().mockResolvedValue(undefined),
  archiveChat: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => ({ state: testState.extrasState, retry: () => Promise.resolve() }),
}));

import { ChatThread } from '../ChatThread';

function chat(overrides: Partial<Chat>): Partial<Chat> {
  return { id: 'chat-9', worktreeMissing: false, transcriptMissing: false, directoryMissing: false, ...overrides };
}

beforeEach(() => {
  testState.extrasState.compacting = false;
  testState.extrasState.chatConfig = chat({});
});

describe('ChatThread — degraded card footer placement', () => {
  it('renders the directory-missing card in the sticky footer instead of the message column', () => {
    testState.extrasState.chatConfig = chat({ directoryMissing: true, missingDirectoryPath: '/gone/proj' });

    render(<ChatThread />);

    const card = screen.getByTestId('chat-degraded-card');
    expect(card.closest('[data-testid="chat-thread-footer"]')).not.toBeNull();
    expect(screen.getByTestId('tp-messages')).not.toContainElement(card);
  });

  it('omits the composer while the working directory is missing', () => {
    testState.extrasState.chatConfig = chat({ directoryMissing: true, missingDirectoryPath: '/gone/proj' });

    render(<ChatThread />);

    expect(screen.queryAllByTestId('chat-composer')).toHaveLength(0);
  });

  it('keeps the composer for transcript-only degradation and places the card in the footer', () => {
    testState.extrasState.chatConfig = chat({ transcriptMissing: true });

    render(<ChatThread />);

    const card = screen.getByTestId('chat-degraded-card');
    expect(card.closest('[data-testid="chat-thread-footer"]')).not.toBeNull();
    expect(screen.getByTestId('chat-composer')).toBeInTheDocument();
  });

  it('renders only the composer when the chat is healthy', () => {
    testState.extrasState.chatConfig = chat({});

    render(<ChatThread />);

    expect(screen.queryByTestId('chat-degraded-card')).toBeNull();
    expect(screen.getByTestId('chat-composer')).toBeInTheDocument();
  });

  it('keeps the degraded card outside ThreadPrimitive.Messages', () => {
    testState.extrasState.chatConfig = chat({ transcriptMissing: true });

    render(<ChatThread />);

    expect(screen.getByTestId('tp-messages')).not.toContainElement(screen.getByTestId('chat-degraded-card'));
  });
});
