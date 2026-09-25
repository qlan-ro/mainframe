/**
 * ChatThread — cold-reload loading spinner (#178, AC13).
 *
 * A reopened offloaded chat has no messages until the daemon re-parses its
 * transcript; a centered spinner covers that gap. Mirrors the mock harness of
 * ChatThread-degraded-placement.test.tsx (a real `useChatExtras` shape, real
 * `useAuiState` selector dispatch) so `loadState`, `messages.length` and
 * `threadListItem.id` can all be driven per test.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode, HTMLAttributes } from 'react';

type LoadState = { type: 'idle' | 'loading' | 'ready' } | { type: 'error'; error: string };

const testState = vi.hoisted(() => ({
  extrasState: { compacting: false, loadState: { type: 'ready' } as LoadState },
  threadListItemId: 'chat-9' as string | null,
  messages: [] as unknown[],
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
    useAuiState: (
      sel: (s: {
        thread: { isRunning: boolean; messages: unknown[] };
        threadListItem: { id: string | null } | undefined;
      }) => unknown,
    ) =>
      sel({
        thread: { isRunning: false, messages: testState.messages },
        threadListItem: testState.threadListItemId == null ? undefined : { id: testState.threadListItemId },
      }),
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
vi.mock('../DegradedChatCard', () => ({ DegradedChatCard: () => null }));
vi.mock('../use-rotating-phrase', () => ({ useRotatingPhrase: () => 'Thinking…' }));
vi.mock('@/features/skills/use-chat-skills', () => ({
  SkillsProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../find/FindBar', () => ({ FindBar: () => null }));
vi.mock('../../tools/register-cards', () => ({}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => ({ state: testState.extrasState, retry: () => Promise.resolve() }),
}));

import { ChatThread } from '../ChatThread';

beforeEach(() => {
  testState.extrasState = { compacting: false, loadState: { type: 'ready' } };
  testState.threadListItemId = 'chat-9';
  testState.messages = [];
});

describe('ChatThread — cold-reload loading spinner', () => {
  it('shows the spinner while loading with no messages on a real (non-draft) chat', () => {
    testState.extrasState.loadState = { type: 'loading' };

    render(<ChatThread />);

    expect(screen.getByTestId('chat-thread-loading')).toBeInTheDocument();
  });

  it('hides the spinner once the load settles to ready', () => {
    testState.extrasState.loadState = { type: 'ready' };

    render(<ChatThread />);

    expect(screen.queryByTestId('chat-thread-loading')).toBeNull();
  });

  it('hides the spinner on a load error (the error banner owns that state)', () => {
    testState.extrasState.loadState = { type: 'error', error: 'boom' };

    render(<ChatThread />);

    expect(screen.queryByTestId('chat-thread-loading')).toBeNull();
  });

  it('hides the spinner once messages have arrived, even if loadState lags', () => {
    testState.extrasState.loadState = { type: 'loading' };
    testState.messages = [{}];

    render(<ChatThread />);

    expect(screen.queryByTestId('chat-thread-loading')).toBeNull();
  });

  it('hides the spinner on a __LOCALID_* draft (a new chat is never a cold reload)', () => {
    testState.extrasState.loadState = { type: 'loading' };
    testState.threadListItemId = '__LOCALID_abc';

    render(<ChatThread />);

    expect(screen.queryByTestId('chat-thread-loading')).toBeNull();
  });

  it('places the spinner inside the viewport, not the sticky footer', () => {
    testState.extrasState.loadState = { type: 'loading' };

    render(<ChatThread />);

    const footer = screen.getByTestId('tp-viewport-footer');
    expect(footer).not.toContainElement(screen.getByTestId('chat-thread-loading'));
    const viewport = screen.getByTestId('chat-thread-viewport');
    expect(viewport).toContainElement(screen.getByTestId('chat-thread-loading'));
  });
});
