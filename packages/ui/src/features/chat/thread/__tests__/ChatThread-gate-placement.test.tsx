/**
 * ChatThread — pending-gate footer placement.
 *
 * The interactive gate (permission / question / plan) belongs in the sticky
 * footer, above the composer, not at the tail of the scrolling transcript
 * column. Mirrors the harness of ChatThread-degraded-placement.test.tsx:
 * ChatGateMount is stubbed as an unconditional marker so placement is
 * observable without permission-front plumbing.
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
vi.mock('../../find/use-find-hotkey', () => ({ useFindHotkey: () => {} }));
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

describe('ChatThread — pending-gate footer placement', () => {
  it('renders the gate mount inside the sticky footer, not the transcript column', () => {
    render(<ChatThread />);

    const stub = screen.getByTestId('gate-mount-stub');
    expect(stub.closest('[data-testid="chat-thread-footer"]')).not.toBeNull();

    const messages = screen.getByTestId('tp-messages');
    expect(messages).not.toContainElement(stub);
    expect(messages.parentElement).not.toContainElement(stub);
  });

  it('places the gate mount before the composer in document order', () => {
    render(<ChatThread />);

    const stub = screen.getByTestId('gate-mount-stub');
    const composer = screen.getByTestId('chat-composer');
    expect(stub.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
