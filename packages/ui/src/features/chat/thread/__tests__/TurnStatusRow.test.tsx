import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelColumnContext, usePanelControl } from '@/features/session-panel/panel-control-store';
import { TurnStatusRow } from '../TurnStatusRow';

type Extras = {
  state: {
    runState: { type: string; startedAtMs?: number };
    compacting?: boolean;
    backgroundTasks?: Record<string, unknown>;
  };
  permissions?: Record<string, unknown>;
};
const fixture = vi.hoisted(() => ({
  thread: { isRunning: true, messages: [] as unknown[] },
  extras: undefined as unknown,
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

const running = (overrides: Partial<Extras['state']> = {}, permissions?: Record<string, unknown>): Extras => ({
  state: { runState: { type: 'running' }, ...overrides },
  permissions,
});
const task = { id: 't1', kind: 'command', description: 'dev server', startedAt: 0 };
function assistant(content: unknown[]) {
  return {
    id: 'a',
    role: 'assistant',
    content,
    status: { type: 'running' },
    metadata: { custom: {} },
  };
}

beforeEach(() => {
  fixture.thread = { isRunning: true, messages: [] };
  fixture.extras = running();
});
afterEach(() => vi.useRealTimers());

describe('TurnStatusRow — phase', () => {
  it('reads Thinking before anything streams, with no Stop control of its own', () => {
    render(<TurnStatusRow />);
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Thinking');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reads Writing while answer text streams', () => {
    fixture.thread.messages = [assistant([{ type: 'text', text: 'Hello' }])];
    render(<TurnStatusRow />);
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Writing');
  });

  it('reads Working while a tool runs and never names the tool', () => {
    fixture.thread.messages = [
      assistant([
        { type: 'tool-call', toolCallId: 'r', toolName: 'Read', args: { file_path: '/a.ts' }, argsText: '{}' },
      ]),
    ];
    render(<TurnStatusRow />);
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Working');
    expect(screen.queryByText(/a\.ts/)).toBeNull();
  });

  it('reads Needs your input in the warning tone while a permission is pending', () => {
    fixture.extras = running({}, { request: { request: { toolUseId: 'call' } } });
    render(<TurnStatusRow />);
    const text = screen.getByTestId('chat-thread-running-text');
    expect(text).toHaveTextContent('Needs your input');
    expect(text).toHaveClass('text-warning');
  });

  it('reads Stopping once Stop was clicked, and Compacting while compacting', () => {
    fixture.extras = running({ runState: { type: 'cancelling' } });
    const view = render(<TurnStatusRow />);
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Stopping');
    view.unmount();
    fixture.extras = running({ compacting: true });
    render(<TurnStatusRow />);
    expect(screen.getByTestId('chat-thread-running-text')).toHaveTextContent('Compacting');
  });
});

describe('TurnStatusRow — elapsed', () => {
  it('shows nothing in the first second, then ticks', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(0);
    render(<TurnStatusRow />);
    expect(screen.queryByTestId('chat-thread-running-elapsed')).toBeNull();
    act(() => void vi.advanceTimersByTime(65_000));
    expect(screen.getByTestId('chat-thread-running-elapsed')).toHaveTextContent('1m 05s');
  });

  it('counts from the daemon turn start', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(125_000);
    fixture.extras = running({ runState: { type: 'running', startedAtMs: 0 } });
    render(<TurnStatusRow />);
    expect(screen.getByTestId('chat-thread-running-elapsed')).toHaveTextContent('2m 05s');
  });
});

describe('TurnStatusRow — background tasks', () => {
  it('renders nothing when idle with no background work', () => {
    fixture.thread.isRunning = false;
    fixture.extras = { state: { runState: { type: 'idle' } } };
    render(<TurnStatusRow />);
    expect(screen.queryByTestId('chat-turn-status')).toBeNull();
  });

  it('outlives the turn while tasks run and reveals them in Activity', () => {
    fixture.thread.isRunning = false;
    fixture.extras = { state: { runState: { type: 'idle' }, backgroundTasks: { t1: task } } };
    usePanelControl.setState({ activityReveals: {} });
    render(
      <PanelColumnContext.Provider value="main">
        <TurnStatusRow />
      </PanelColumnContext.Provider>,
    );
    expect(screen.queryByTestId('chat-thread-running')).toBeNull();
    fireEvent.click(screen.getByTestId('chat-thread-running-tasks'));
    expect(usePanelControl.getState().activityReveals.main).toBe(1);
  });

  it('shows the count as plain text outside a panel column', () => {
    fixture.extras = running({ backgroundTasks: { t1: task } });
    render(<TurnStatusRow />);
    const tasks = screen.getByTestId('chat-thread-running-tasks');
    expect(tasks.tagName).toBe('SPAN');
    expect(tasks).toHaveTextContent('1 running task');
  });

  it('flashes "N tasks finished" when the last task ends, then disappears', () => {
    vi.useFakeTimers();
    fixture.thread.isRunning = false;
    fixture.extras = { state: { runState: { type: 'idle' }, backgroundTasks: { t1: task, t2: task } } };
    render(<TurnStatusRow />);
    update(() => (fixture.extras = { state: { runState: { type: 'idle' }, backgroundTasks: {} } }));
    expect(screen.getByTestId('chat-thread-tasks-finished')).toHaveTextContent('2 tasks finished');
    act(() => void vi.advanceTimersByTime(1500));
    expect(screen.queryByTestId('chat-turn-status')).toBeNull();
  });
});
