/** Reconnect status in the turn status row and in a hosting activity header's trailing slot (todo #406). */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnStatusRow, TurnStatusTrailing } from '../TurnStatusRow';

type Retry = { attempt: number; maxAttempts?: number } | null;
const fixture = vi.hoisted(() => ({
  thread: { isRunning: true, messages: [] as unknown[] },
  extras: undefined as unknown,
  host: null as string | null,
  listeners: new Set<() => void>(),
}));
function update(change: () => void) {
  act(() => {
    change();
    for (const listener of fixture.listeners) listener();
  });
}
vi.mock('@assistant-ui/react', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    fixture.listeners.add(listener);
    return () => void fixture.listeners.delete(listener);
  };
  return {
    useAuiState: (selector: (s: { thread: typeof fixture.thread }) => unknown) =>
      useSyncExternalStore(subscribe, () => selector({ thread: fixture.thread })),
  };
});
vi.mock('../../runtime/chat-extras', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    fixture.listeners.add(listener);
    return () => void fixture.listeners.delete(listener);
  };
  return {
    useChatExtras: () => useSyncExternalStore(subscribe, () => fixture.extras),
    useChatExtrasSelector: (select: (extras: unknown) => unknown) =>
      useSyncExternalStore(subscribe, () => select(fixture.extras)),
  };
});
vi.mock('../turn-status-host', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    fixture.listeners.add(listener);
    return () => void fixture.listeners.delete(listener);
  };
  return { useTurnStatusHost: () => useSyncExternalStore(subscribe, () => fixture.host) };
});

const extras = (retry: Retry, state: Record<string, unknown> = {}, permissions?: Record<string, unknown>) => ({
  state: { chatId: 'chat-1', runState: { type: 'running' }, retry, ...state },
  permissions,
});
const TEST_ID = 'chat-retry-status-chat-1';

beforeEach(() => {
  fixture.thread = { isRunning: true, messages: [] };
  fixture.host = null;
  fixture.extras = extras({ attempt: 2, maxAttempts: 5 });
});
afterEach(() => vi.useRealTimers());

describe('TurnStatusRow — Reconnecting', () => {
  it('replaces the stream phase with the label, under the chat test id, with a warning dot and normal text', () => {
    fixture.thread.messages = [
      {
        id: 'a',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi' }],
        status: { type: 'running' },
        metadata: { custom: {} },
      },
    ];
    const { container } = render(<TurnStatusRow />);
    const text = screen.getByTestId('chat-thread-running-text');
    expect(text).toHaveTextContent('Reconnecting (2/5)…');
    expect(screen.getAllByTestId(TEST_ID)).toHaveLength(1);
    expect(screen.getByTestId(TEST_ID)).toContainElement(text);
    expect(text).toHaveClass('text-muted-foreground');
    expect(text).not.toHaveClass('text-warning');
    expect(container.querySelector('[data-testid="chat-thread-running"] > span[aria-hidden]')).toHaveClass(
      'bg-warning',
    );
  });

  it('keeps the fixed row height and a single truncating line', () => {
    render(<TurnStatusRow />);
    expect(screen.getByTestId('chat-turn-status')).toHaveClass('h-7');
    expect(screen.getByTestId(TEST_ID)).toHaveClass('truncate');
  });

  it('shows the attempt-only and unknown-attempt forms', () => {
    fixture.extras = extras({ attempt: 2 });
    const view = render(<TurnStatusRow />);
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Reconnecting (2)…');
    view.unmount();
    fixture.extras = extras({ attempt: 0 });
    render(<TurnStatusRow />);
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Reconnecting…');
  });

  it('updates the numbers at once on a later retry', () => {
    render(<TurnStatusRow />);
    update(() => (fixture.extras = extras({ attempt: 3, maxAttempts: 5 })));
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Reconnecting (3/5)…');
  });

  it('reads Needs your input, Stopping and Compacting instead, with no retry test id', () => {
    fixture.extras = extras({ attempt: 2, maxAttempts: 5 }, {}, { r: { request: { toolUseId: 'c' } } });
    const view = render(<TurnStatusRow />);
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Needs your input');
    expect(screen.queryByTestId(TEST_ID)).toBeNull();
    view.unmount();
    fixture.extras = extras({ attempt: 2, maxAttempts: 5 }, { runState: { type: 'cancelling' } });
    const stopping = render(<TurnStatusRow />);
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Stopping');
    stopping.unmount();
    fixture.extras = extras({ attempt: 2, maxAttempts: 5 }, { compacting: true });
    render(<TurnStatusRow />);
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Compacting');
    expect(screen.queryByTestId(TEST_ID)).toBeNull();
  });

  it('shows Reconnecting again when a higher phase ends while the retry is pending', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fixture.extras = extras({ attempt: 2, maxAttempts: 5 }, { compacting: true });
    render(<TurnStatusRow />);
    update(() => (fixture.extras = extras({ attempt: 2, maxAttempts: 5 })));
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Reconnecting (2/5)…');
  });

  it('drops the label and its test id within the phase dwell once the retry clears', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<TurnStatusRow />);
    update(() => (fixture.extras = extras(null)));
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId(TEST_ID)).toBeNull();
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Thinking');
  });

  it('renders no row at all once the turn ends', () => {
    fixture.thread.isRunning = false;
    render(<TurnStatusRow />);
    expect(screen.queryByTestId(TEST_ID)).toBeNull();
  });
});

describe('TurnStatusTrailing — Reconnecting in a hosting header', () => {
  it('shows the label once, ahead of the clock, and the row steps aside without a second copy', () => {
    fixture.host = 'group-1';
    render(
      <>
        <TurnStatusRow />
        <TurnStatusTrailing />
      </>,
    );
    const matches = screen.getAllByTestId(TEST_ID);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toHaveTextContent('Reconnecting (2/5)…');
    expect(screen.getAllByText(/Reconnecting/)).toHaveLength(1);
  });

  it('uses a warning dot with normal-colour text', () => {
    render(<TurnStatusTrailing />);
    const label = screen.getByTestId(TEST_ID);
    expect(label.querySelector('[aria-hidden]')).toHaveClass('bg-warning');
    expect(label).toHaveClass('text-muted-foreground');
    expect(label).not.toHaveClass('text-warning');
  });

  it('shows nothing extra without a retry, and yields to Compacting, Stopping and a pending input', () => {
    fixture.extras = extras(null);
    const view = render(<TurnStatusTrailing />);
    expect(screen.queryByTestId(TEST_ID)).toBeNull();
    view.unmount();
    for (const higher of [
      extras({ attempt: 2 }, { compacting: true }),
      extras({ attempt: 2 }, { runState: { type: 'cancelling' } }),
      extras({ attempt: 2 }, {}, { r: {} }),
    ]) {
      fixture.extras = higher;
      const rendered = render(<TurnStatusTrailing />);
      expect(screen.queryByTestId(TEST_ID)).toBeNull();
      rendered.unmount();
    }
  });

  it('clears at once when the retry clears', () => {
    render(<TurnStatusTrailing />);
    update(() => (fixture.extras = extras(null)));
    expect(screen.queryByTestId(TEST_ID)).toBeNull();
  });
});
