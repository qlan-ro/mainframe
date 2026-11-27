/**
 * ChatThread — cold-reload loading spinner (#178, AC13).
 *
 * A reopened offloaded chat has no messages until the daemon re-parses its
 * transcript; a centered spinner covers that gap. Mirrors the mock harness of
 * ChatThread-degraded-placement.test.tsx (a real `useChatExtras` shape, real
 * `useAuiState` selector dispatch) so `loadState`, `messages.length` and
 * `threadListItem.id` can all be driven per test.
 */
import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSyncExternalStore, type ReactNode, type HTMLAttributes } from 'react';

type LoadState = { type: 'idle' | 'loading' | 'ready' } | { type: 'error'; error: string };

const testState = vi.hoisted(() => ({
  extrasState: { compacting: false, loadState: { type: 'ready' } as LoadState, runState: { type: 'idle' } },
  threadListItemId: 'chat-9' as string | null,
  messages: [] as unknown[],
  version: 0,
  listeners: new Set<() => void>(),
}));
/** The mocks below re-read `testState`; this makes a change re-render their readers (the compiler memoizes the rest). */
const change = (apply: () => void) => {
  apply();
  act(() => {
    testState.version++;
    testState.listeners.forEach((listener) => listener());
  });
};
const useVersion = () =>
  useSyncExternalStore(
    (listener) => {
      testState.listeners.add(listener);
      return () => testState.listeners.delete(listener);
    },
    () => testState.version,
  );

vi.mock('../VirtualMessages', () => ({ VirtualMessages: () => <div data-testid="tp-messages" /> }));
vi.mock('@assistant-ui/react', () => {
  type DivProps = HTMLAttributes<HTMLDivElement> & { children?: ReactNode };
  return {
    ThreadPrimitive: {
      Root: ({ children, ...props }: DivProps) => <div {...props}>{children}</div>,
      Viewport: ({ children, ...props }: DivProps) => <div {...props}>{children}</div>,
      ScrollToBottom: ({ children }: { children?: ReactNode }) => <>{children}</>,
      Messages: () => <div data-testid="tp-messages" />,
    },
    useAui: () => ({}),
    useAuiState: (
      sel: (s: {
        thread: { isRunning: boolean; messages: unknown[] };
        threadListItem: { id: string | null } | undefined;
      }) => unknown,
    ) => {
      useVersion();
      return sel({
        thread: { isRunning: false, messages: testState.messages },
        threadListItem: testState.threadListItemId == null ? undefined : { id: testState.threadListItemId },
      });
    },
  };
});

vi.mock('../../messages/turn/TurnTranscript', () => ({ TurnTranscript: () => <div data-testid="messages-stub" /> }));
vi.mock('../../composer/Composer', () => ({ Composer: () => <div data-testid="chat-composer" /> }));
vi.mock('../../composer/WorktreeSwitchBanner', () => ({ WorktreeSwitchBanner: () => null }));
vi.mock('../../composer/strips/BottomStrip', () => ({ BottomStrip: () => null }));
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
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => {
    useVersion();
    return { state: testState.extrasState, retry: () => Promise.resolve() };
  },
}));

import { ChatThread } from '../ChatThread';
import { LOADING_DELAY_MS, LOADING_MIN_VISIBLE_MS } from '../ChatThreadIndicators';

const settle = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  testState.extrasState = { compacting: false, loadState: { type: 'ready' }, runState: { type: 'idle' } };
  testState.threadListItemId = 'chat-9';
  testState.messages = [];
});
afterEach(() => vi.useRealTimers());

describe('ChatThread — cold-reload loading spinner', () => {
  it('shows the spinner once a load with no messages on a real (non-draft) chat outlasts the delay', () => {
    testState.extrasState.loadState = { type: 'loading' };

    render(<ChatThread />);
    expect(screen.queryByTestId('chat-thread-loading')).toBeNull();
    settle(LOADING_DELAY_MS);

    expect(screen.getByTestId('chat-thread-loading')).toBeInTheDocument();
  });

  it('shows nothing for a load that finishes inside the delay', () => {
    testState.extrasState.loadState = { type: 'loading' };
    render(<ChatThread />);
    settle(LOADING_DELAY_MS - 50);

    change(() => (testState.extrasState.loadState = { type: 'ready' }));
    settle(1000);

    expect(screen.queryByTestId('chat-thread-loading')).toBeNull();
  });

  it('keeps a shown spinner for at least the minimum, then removes it', () => {
    testState.extrasState.loadState = { type: 'loading' };
    render(<ChatThread />);
    settle(LOADING_DELAY_MS);
    expect(screen.getByTestId('chat-thread-loading')).toBeInTheDocument();

    change(() => (testState.extrasState.loadState = { type: 'ready' }));
    settle(LOADING_MIN_VISIBLE_MS - 50);
    expect(screen.getByTestId('chat-thread-loading')).toBeInTheDocument();
    settle(60);

    expect(screen.queryByTestId('chat-thread-loading')).toBeNull();
  });

  it('starts over on a chat switch: a load in a new chat waits the delay again', () => {
    testState.extrasState.loadState = { type: 'loading' };
    render(<ChatThread />);
    settle(LOADING_DELAY_MS);
    expect(screen.getByTestId('chat-thread-loading')).toBeInTheDocument();

    change(() => (testState.threadListItemId = 'chat-10'));
    expect(screen.queryByTestId('chat-thread-loading')).toBeNull();
    settle(LOADING_DELAY_MS);

    expect(screen.getByTestId('chat-thread-loading')).toBeInTheDocument();
  });

  it('keeps the spinner while a run that is still loading has only assistant-ui’s stand-in', () => {
    testState.extrasState.loadState = { type: 'loading' };
    testState.messages = [{ id: 'p', role: 'assistant', content: [], metadata: { isOptimistic: true } }];
    render(<ChatThread />);
    settle(LOADING_DELAY_MS);
    expect(screen.getByTestId('chat-thread-loading')).toBeInTheDocument();
  });

  it('hides the spinner once the load settles to ready', () => {
    testState.extrasState.loadState = { type: 'ready' };

    render(<ChatThread />);
    settle(1000);

    expect(screen.queryByTestId('chat-thread-loading')).toBeNull();
  });

  it('replaces a shown spinner at once on a load error (the error banner owns that state)', () => {
    testState.extrasState.loadState = { type: 'loading' };
    render(<ChatThread />);
    settle(LOADING_DELAY_MS);
    expect(screen.getByTestId('chat-thread-loading')).toBeInTheDocument();

    change(() => (testState.extrasState.loadState = { type: 'error', error: 'boom' }));

    expect(screen.queryByTestId('chat-thread-loading')).toBeNull();
    expect(screen.getByTestId('chat-thread-load-error')).toBeInTheDocument();
  });

  it('hides the spinner once messages have arrived, even if loadState lags', () => {
    testState.extrasState.loadState = { type: 'loading' };
    testState.messages = [{}];

    render(<ChatThread />);
    settle(1000);

    expect(screen.queryByTestId('chat-thread-loading')).toBeNull();
  });

  it('hides the spinner on a __LOCALID_* draft (a new chat is never a cold reload)', () => {
    testState.extrasState.loadState = { type: 'loading' };
    testState.threadListItemId = '__LOCALID_abc';

    render(<ChatThread />);
    settle(1000);

    expect(screen.queryByTestId('chat-thread-loading')).toBeNull();
  });

  it('places the spinner inside the viewport, not the sticky footer', () => {
    testState.extrasState.loadState = { type: 'loading' };

    render(<ChatThread />);
    settle(LOADING_DELAY_MS);

    const footer = screen.getByTestId('chat-thread-footer').parentElement!;
    expect(footer).not.toContainElement(screen.getByTestId('chat-thread-loading'));
    const viewport = screen.getByTestId('chat-thread-viewport');
    expect(viewport).toContainElement(screen.getByTestId('chat-thread-loading'));
  });
});
