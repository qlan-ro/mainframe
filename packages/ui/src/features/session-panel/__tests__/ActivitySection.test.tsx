import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ActivityEntry } from '../activity-model';
import { usePanelControl } from '../panel-control-store';

const state = vi.hoisted(() => ({
  entries: [] as ActivityEntry[],
  adapterId: 'claude' as string | undefined,
  chatId: 'chat-1',
  history: undefined as { hasMore: boolean; loading: boolean; error?: string } | undefined,
  loadEarlier: vi.fn(),
  jump: vi.fn(),
  cancelJump: vi.fn(),
  focusRequest: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  output: vi.fn(),
  threads: {},
  openTask: vi.fn(),
  openSubagent: vi.fn(),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('../use-activity-entries', () => ({
  useActivityEntries: () => ({
    entries: state.entries,
    chatId: state.chatId,
    adapterId: state.adapterId,
    now: 600_000,
    loadError: null,
  }),
}));
vi.mock('../activity-source', () => ({
  jumpToActivitySource: state.jump,
  cancelActivityJump: state.cancelJump,
  focusPendingRequest: state.focusRequest,
}));
vi.mock('@/lib/api/background-tasks', () => ({
  stopBackgroundTask: state.stop,
  cancelDelegatedTask: state.cancel,
  readBackgroundTaskOutput: state.output,
}));
vi.mock('@/lib/toast', () => ({ mfToast: state.toast }));
vi.mock('@/features/chat/runtime/chat-extras', () => ({
  useChatExtras: () => ({ state: { historyWindow: state.history }, loadEarlier: state.loadEarlier }),
}));
vi.mock('@assistant-ui/react', () => ({ useAui: () => ({ threads: state.threads }) }));
vi.mock('@/features/chat/workflow/use-workflow-run', () => ({ useWorkflowRun: () => undefined }));
vi.mock('@/features/workspace-chat/open-session', () => ({ openTaskTab: state.openTask }));
vi.mock('@/features/workspace-chat/conversation-tabs', () => ({ openSubagentTab: state.openSubagent }));
// The run's detail panel reaches for the chat runtime; no workflow here has a run.
vi.mock('../WorkflowPhases', () => ({ WorkflowPhases: () => null }));

const { ActivitySection } = await import('../ActivitySection');

const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: TooltipProvider });
const row = (id: string, overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id,
  kind: 'subagent',
  title: id,
  detail: 'explorer',
  state: 'running',
  startedAt: 300_000,
  ...overrides,
});
const source = { messageId: 'message-1', toolCallId: 'call-1' };
const task = { id: 'bg-1', toolUseId: 'call-1' } as BackgroundTask;
const clickRow = (id: string) => fireEvent.click(screen.getByTestId(`session-panel-activity-${id}`));

beforeEach(() => {
  vi.clearAllMocks();
  state.entries = [];
  state.adapterId = 'claude';
  state.history = undefined;
  state.chatId = 'chat-1';
  state.jump.mockImplementation((_chatId: string, _source: unknown, onLocated: () => void) => {
    onLocated();
    return Promise.resolve('shown');
  });
  state.focusRequest.mockReturnValue(true);
  state.stop.mockResolvedValue(undefined);
  state.cancel.mockResolvedValue(undefined);
  usePanelControl.setState({ overlayOpen: { main: true } });
});

describe('ActivitySection', () => {
  it('says there is no background activity, under a label that is only the name', () => {
    render(<ActivitySection columnId="main" />);
    expect(screen.getByTestId('session-panel-activity-empty')).toHaveTextContent('No background activity');
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel-activity-earlier')).toBeNull();
  });

  it('collapses finished work under Earlier with its failed count', () => {
    state.entries = [
      row('done', { state: 'completed', endedAt: 1 }),
      row('broken', { state: 'failed', endedAt: 2 }),
      row('live'),
    ];
    render(<ActivitySection columnId="main" />);
    const earlier = screen.getByRole('button', { name: 'Earlier, 2 items, 1 failed' });
    expect(earlier).toHaveAttribute('aria-expanded', 'false');
    expect(earlier).toHaveTextContent('1 failed');
    expect(screen.getByTestId('session-panel-activity-live')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel-activity-done')).toBeNull();
    fireEvent.click(earlier);
    expect(screen.getByTestId('session-panel-activity-done')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-activity-broken')).toHaveTextContent('failed');
    fireEvent.click(earlier);
    expect(screen.queryByTestId('session-panel-activity-done')).toBeNull();
  });

  it('marks an open-ended history and loads more of it from Earlier', () => {
    state.history = { hasMore: true, loading: false };
    state.entries = [row('done', { state: 'completed', endedAt: 1 })];
    state.loadEarlier.mockResolvedValue(undefined);
    render(<ActivitySection columnId="main" />);
    const earlier = screen.getByRole('button', { name: 'Earlier, 1 item or more' });
    expect(earlier).toHaveTextContent('1+');
    fireEvent.click(earlier);
    fireEvent.click(screen.getByTestId('session-panel-load-earlier'));
    expect(state.loadEarlier).toHaveBeenCalledOnce();
  });
});

describe('ActivitySection — row clicks', () => {
  it.each(['monitor', 'command', 'scheduled'] as const)('a %s goes to its transcript row', (kind) => {
    state.entries = [row('r', { kind, source })];
    render(<ActivitySection columnId="main" />);
    clickRow('r');
    expect(state.jump).toHaveBeenCalledWith('chat-1', source, expect.any(Function));
    // The floating panel would cover the row it went to.
    expect(usePanelControl.getState().overlayOpen.main).toBe(false);
  });

  it('says so when the row is not in the loaded history', async () => {
    state.jump.mockResolvedValue('missing');
    state.entries = [row('r', { kind: 'monitor', source })];
    render(<ActivitySection columnId="main" />);
    clickRow('r');
    await waitFor(() => expect(state.toast.info).toHaveBeenCalledWith('“r” started before the history shown here'));
  });

  it('opens a sub-agent’s work in the workspace', () => {
    state.entries = [row('agent', { source, task })];
    render(<ActivitySection columnId="main" />);
    clickRow('agent');
    expect(state.openSubagent).toHaveBeenCalledWith(
      { chatId: 'chat-1', toolCallId: 'call-1', messageId: 'message-1', title: 'agent' },
      { focus: true },
    );
    expect(usePanelControl.getState().overlayOpen.main).toBe(false);
    expect(state.jump).not.toHaveBeenCalled();
  });

  it('opens the work of a sub-agent that started before the loaded history', () => {
    state.entries = [row('agent', { source: { toolCallId: 'call-0' }, task })];
    render(<ActivitySection columnId="main" />);
    clickRow('agent');
    expect(state.openSubagent).toHaveBeenCalledWith(
      { chatId: 'chat-1', toolCallId: 'call-0', messageId: undefined, title: 'agent' },
      { focus: true },
    );
    expect(state.jump).not.toHaveBeenCalled();
  });

  it('says so when nothing in the loaded history stands for the row', () => {
    state.entries = [row('r', { kind: 'background' })];
    render(<ActivitySection columnId="main" />);
    clickRow('r');
    expect(state.toast.info).toHaveBeenCalledWith('“r” started before the history shown here');
    expect(state.jump).not.toHaveBeenCalled();
    expect(usePanelControl.getState().overlayOpen.main).toBe(true);
  });

  it('opens a delegated task’s chat', () => {
    state.entries = [row('task', { kind: 'delegated', delegated: { taskId: 't-1', itemId: 'child' } as never })];
    render(<ActivitySection columnId="main" />);
    clickRow('task');
    expect(state.openTask).toHaveBeenCalledWith(state.threads, 'child', { focus: true });
    expect(usePanelControl.getState().overlayOpen.main).toBe(false);
  });

  it('a sub-agent that needs you takes focus to its request', () => {
    state.entries = [row('agent', { state: 'needs-you', source, task })];
    render(<ActivitySection columnId="main" />);
    clickRow('agent');
    expect(state.focusRequest).toHaveBeenCalledWith('chat-1');
    expect(state.openSubagent).not.toHaveBeenCalled();
  });
});

describe('ActivitySection — a jump that waits for history', () => {
  /** Jumps answered by hand, in the order they were asked for. */
  function heldJumps() {
    const held: { located: () => void; settle: (outcome: string) => void; fail: (error: unknown) => void }[] = [];
    state.jump.mockImplementation(
      (_chatId: string, _source: unknown, located: () => void) =>
        new Promise((settle, fail) => held.push({ located, settle, fail })),
    );
    return held;
  }
  const loading = (id: string) => screen.queryByRole('button', { name: new RegExp(`${id}, loading$`) });
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());
  const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it('shows it on the row, in the open panel, until the message is there', async () => {
    const held = heldJumps();
    state.entries = [row('slow', { kind: 'monitor', source })];
    render(<ActivitySection columnId="main" />);
    clickRow('slow');
    await wait(100);
    expect(loading('slow')).toBeNull();
    await wait(100);
    expect(loading('slow')).not.toBeNull();
    expect(usePanelControl.getState().overlayOpen.main).toBe(true);
    act(() => held[0]!.located());
    expect(loading('slow')).toBeNull();
    expect(usePanelControl.getState().overlayOpen.main).toBe(false);
  });

  it('moves to the row clicked last, and the first one’s end leaves it there', async () => {
    const held = heldJumps();
    state.entries = [row('one', { kind: 'monitor', source }), row('two', { kind: 'monitor', source })];
    render(<ActivitySection columnId="main" />);
    clickRow('one');
    await wait(200);
    clickRow('two');
    await wait(200);
    expect(loading('one')).toBeNull();
    expect(loading('two')).not.toBeNull();
    await act(async () => held[0]!.settle('superseded'));
    expect(loading('two')).not.toBeNull();
    await act(async () => held[1]!.settle('missing'));
    expect(loading('two')).toBeNull();
    expect(state.toast.info).toHaveBeenCalledExactlyOnceWith('“two” started before the history shown here');
  });

  it('says nothing about a jump that something else replaced', async () => {
    const held = heldJumps();
    state.entries = [row('slow', { kind: 'monitor', source })];
    render(<ActivitySection columnId="main" />);
    clickRow('slow');
    await act(async () => held[0]!.settle('superseded'));
    expect(state.toast.info).not.toHaveBeenCalled();
    expect(state.toast.error).not.toHaveBeenCalled();
  });

  it('is not shown on another session’s rows', async () => {
    heldJumps();
    state.entries = [row('slow', { kind: 'monitor', source })];
    const view = render(<ActivitySection columnId="main" />);
    clickRow('slow');
    await wait(200);
    state.chatId = 'chat-2';
    view.rerender(<ActivitySection columnId="main" />);
    expect(loading('slow')).toBeNull();
  });

  it.each([
    ['an agent’s transcript', row('other', { source, task })],
    ['a delegated task’s chat', row('other', { kind: 'delegated', delegated: { itemId: 'child' } as never })],
    ['a request', row('other', { state: 'needs-you', source, task })],
  ])('gives way to %s', async (_case, other) => {
    heldJumps();
    state.entries = [row('slow', { kind: 'monitor', source }), other];
    render(<ActivitySection columnId="main" />);
    clickRow('slow');
    await wait(200);
    state.cancelJump.mockClear();
    clickRow('other');
    expect(state.cancelJump).toHaveBeenCalled();
    expect(loading('slow')).toBeNull();
  });

  it.each([
    ['an Error', new Error('offline'), 'offline'],
    ['a JSON-RPC error', { code: -32000, message: 'request timed out' }, 'request timed out'],
    ['nothing readable', { code: 1 }, 'Unknown error'],
  ])('says why it failed when the rejection is %s', async (_case, rejection, description) => {
    const held = heldJumps();
    state.entries = [row('slow', { kind: 'monitor', source })];
    render(<ActivitySection columnId="main" />);
    clickRow('slow');
    await wait(200);
    await act(async () => held[0]!.fail(rejection));
    expect(state.toast.error).toHaveBeenCalledWith('Could not load the message', { description });
    expect(loading('slow')).toBeNull();
  });
});

describe('ActivitySection — focus', () => {
  const ended = (id: string) => row(id, { state: 'stopped', endedAt: 1, source });
  const focusStop = (id: string) => screen.getByRole('button', { name: `Stop ${id}` }).focus();
  const rowOf = (id: string) => screen.getByTestId(`session-panel-activity-${id}`);

  it('goes to Earlier when a stopped row moves into it, and to the row where Earlier is open', () => {
    state.entries = [row('a', { task, source }), row('b', { task, source }), ended('old')];
    const view = render(<ActivitySection columnId="main" />);
    focusStop('a');
    state.entries = [ended('a'), row('b', { task, source }), ended('old')];
    view.rerender(<ActivitySection columnId="main" />);
    expect(screen.getByTestId('session-panel-activity-earlier')).toHaveFocus();

    fireEvent.click(screen.getByTestId('session-panel-activity-earlier'));
    focusStop('b');
    state.entries = [ended('a'), ended('b'), ended('old')];
    view.rerender(<ActivitySection columnId="main" />);
    expect(rowOf('b')).toHaveFocus();
  });

  it('goes to the nearest row when the row is gone, then to the section', () => {
    state.entries = ['a', 'b', 'c'].map((id) => row(id, { task, source }));
    const view = render(<ActivitySection columnId="main" />);
    focusStop('b');
    state.entries = ['a', 'c'].map((id) => row(id, { task, source }));
    view.rerender(<ActivitySection columnId="main" />);
    expect(rowOf('c')).toHaveFocus();
    state.entries = [row('a', { task, source })];
    view.rerender(<ActivitySection columnId="main" />);
    expect(rowOf('a')).toHaveFocus();
    state.entries = [];
    view.rerender(<ActivitySection columnId="main" />);
    expect(screen.getByTestId('session-panel-card-activity')).toHaveFocus();
  });

  it('follows a row that comes back out of Earlier', () => {
    const delegated = { taskId: 't-1', itemId: 'child' };
    const live = row('task', { kind: 'delegated', delegated: delegated as never });
    state.entries = [live];
    const view = render(<ActivitySection columnId="main" />);
    focusStop('task');
    state.entries = [{ ...live, state: 'stopped', endedAt: 1 }];
    view.rerender(<ActivitySection columnId="main" />);
    expect(screen.getByTestId('session-panel-activity-earlier')).toHaveFocus();
    // Its child's chat went on.
    state.entries = [{ ...live, delegated: { ...delegated, resumedState: 'running' } as never }];
    view.rerender(<ActivitySection columnId="main" />);
    expect(rowOf('task')).toHaveFocus();
  });

  it('is not taken from elsewhere, nor for another session’s rows', () => {
    state.entries = [row('a', { task, source }), row('b', { task, source })];
    const view = render(<ActivitySection columnId="main" />);
    state.entries = [row('b', { task, source })];
    view.rerender(<ActivitySection columnId="main" />);
    expect(document.body).toHaveFocus();

    focusStop('b');
    state.chatId = 'chat-2';
    state.entries = [row('z', { task, source })];
    view.rerender(<ActivitySection columnId="main" />);
    expect(document.body).toHaveFocus();
  });
});

describe('ActivitySection — a background command’s output', () => {
  const command = (overrides: Partial<ActivityEntry> = {}) =>
    row('Build', { kind: 'command', command: 'pnpm build', task, source, ...overrides });
  const open = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Full output of Build' }));
    return within(await screen.findByRole('dialog', { name: 'Build' }));
  };

  it('is read when it opens, whole, and gives focus back to the row', async () => {
    state.output.mockResolvedValue({ text: '✓ built in 42s', truncated: false });
    state.entries = [command()];
    render(<ActivitySection columnId="main" />);
    expect(state.output).not.toHaveBeenCalled();
    const dialog = await open();
    expect(await dialog.findByText('✓ built in 42s')).toBeInTheDocument();
    expect(dialog.getByText('pnpm build')).toBeInTheDocument();
    expect(dialog.queryByTestId('session-panel-output-truncated')).toBeNull();
    expect(state.output).toHaveBeenCalledExactlyOnceWith('chat-1', 'bg-1');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByTestId('session-panel-activity-Build')).toHaveFocus());
  });

  it('says when its start is left out', async () => {
    state.output.mockResolvedValue({ text: 'the end', truncated: true });
    state.entries = [command()];
    render(<ActivitySection columnId="main" />);
    const dialog = await open();
    expect(await dialog.findByTestId('session-panel-output-truncated')).toHaveTextContent(
      'The start is left out. This is the last 1 MB.',
    );
  });

  it('says when there is none, and when it could not be read', async () => {
    state.output
      .mockResolvedValueOnce({ text: '', truncated: false })
      .mockRejectedValueOnce(new Error('Output request failed (500)'));
    state.entries = [command()];
    render(<ActivitySection columnId="main" />);
    expect(await (await open()).findByText('No output')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(await (await open()).findByRole('alert')).toHaveTextContent('Output request failed (500)');
  });

  it('stays open when its command ends, reads the rest, and gives focus to where the row went', async () => {
    state.output
      .mockResolvedValueOnce({ text: 'building', truncated: false })
      .mockResolvedValueOnce({ text: 'building, built', truncated: false });
    state.entries = [command()];
    const view = render(<ActivitySection columnId="main" />);
    const dialog = await open();
    await dialog.findByText('building');
    state.entries = [command({ state: 'completed', endedAt: 1 })];
    view.rerender(<ActivitySection columnId="main" />);
    expect(screen.queryByTestId('session-panel-activity-Build')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Build' })).toBeInTheDocument();
    expect(await dialog.findByText('building, built')).toBeInTheDocument();
    expect(state.output).toHaveBeenCalledTimes(2);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByTestId('session-panel-activity-earlier')).toHaveFocus());
  });

  it('closes with its session', async () => {
    state.output.mockResolvedValue({ text: 'building', truncated: false });
    state.entries = [command()];
    const view = render(<ActivitySection columnId="main" />);
    await open();
    state.chatId = 'chat-2';
    state.entries = [];
    view.rerender(<ActivitySection columnId="main" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('ActivitySection — Stop', () => {
  const openMenu = (id: string) => fireEvent.contextMenu(screen.getByTestId(`session-panel-activity-${id}`));

  it('stops a Claude task by its id and says so', async () => {
    state.entries = [row('agent', { task, source })];
    render(<ActivitySection columnId="main" />);
    openMenu('agent');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
    expect(state.stop).toHaveBeenCalledWith('chat-1', 'bg-1');
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('Stopped “agent”'));
  });

  it('cancels a delegated task, and not one whose finished chat was resumed', async () => {
    const delegated = { taskId: 't-1', itemId: 'child' };
    state.entries = [row('task', { kind: 'delegated', delegated: delegated as never, source })];
    const view = render(<ActivitySection columnId="main" />);
    openMenu('task');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
    expect(state.cancel).toHaveBeenCalledWith('chat-1', 't-1');

    state.entries = [
      row('task', { kind: 'delegated', delegated: { ...delegated, resumedState: 'running' } as never, source }),
    ];
    view.rerender(<ActivitySection columnId="main" />);
    openMenu('task');
    await screen.findByRole('menuitem', { name: 'Show in transcript' });
    expect(screen.queryByRole('menuitem', { name: 'Stop' })).toBeNull();
  });

  it.each(['codex', 'mock-cli', undefined])(
    'offers no Stop to a %s task, and one to its delegated task',
    (adapterId) => {
      state.adapterId = adapterId;
      state.entries = [
        row('agent', { task, source }),
        row('task', { kind: 'delegated', delegated: { taskId: 't-1', itemId: 'child' } as never }),
      ];
      render(<ActivitySection columnId="main" />);
      expect(screen.queryByRole('button', { name: 'Stop agent' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Stop task' })).toBeInTheDocument();
    },
  );

  it('can be asked again when the work is still there ten seconds after it went through', async () => {
    vi.useFakeTimers();
    try {
      state.entries = [row('agent', { task, source })];
      const view = render(<ActivitySection columnId="main" />);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop agent' })));
      await act(() => vi.advanceTimersByTimeAsync(9_900));
      fireEvent.click(screen.getByRole('button', { name: 'Stopping agent' }));
      expect(state.stop).toHaveBeenCalledOnce();
      await act(() => vi.advanceTimersByTimeAsync(200));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop agent' })));
      expect(state.stop).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers no Stop where the adapter cannot stop a task, or once it ended', async () => {
    state.adapterId = 'codex';
    state.entries = [row('agent', { task, source })];
    const view = render(<ActivitySection columnId="main" />);
    openMenu('agent');
    await screen.findByRole('menuitem', { name: 'Show in transcript' });
    expect(screen.queryByRole('menuitem', { name: 'Stop' })).toBeNull();
    view.unmount();

    state.adapterId = 'claude';
    state.entries = [row('agent', { task, source, state: 'completed', endedAt: 1 })];
    render(<ActivitySection columnId="main" />);
    fireEvent.click(screen.getByTestId('session-panel-activity-earlier'));
    openMenu('agent');
    await screen.findByRole('menuitem', { name: 'Show in transcript' });
    expect(screen.queryByRole('menuitem', { name: 'Stop' })).toBeNull();
  });

  it('sends one request however often Stop is pressed, and again after it failed', async () => {
    let fail: (error: Error) => void = () => {};
    state.stop.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    state.entries = [row('agent', { task, source })];
    render(<ActivitySection columnId="main" />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stopping agent' }));
    expect(state.stop).toHaveBeenCalledOnce();
    expect(screen.getByTestId('session-panel-activity-agent')).toHaveTextContent('stopping');

    fail(new Error('gone'));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop agent' }));
    expect(state.stop).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('Stopped “agent”'));
    // Still running until the daemon says otherwise; not a second request.
    fireEvent.click(screen.getByRole('button', { name: 'Stopping agent' }));
    expect(state.stop).toHaveBeenCalledTimes(2);
  });

  it('reads a background command’s output, and no other row’s', async () => {
    state.output.mockResolvedValue({ text: 'all green', truncated: false });
    state.entries = [row('cmd', { kind: 'command', task, source }), row('agent', { task, source })];
    render(<ActivitySection columnId="main" />);
    openMenu('cmd');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Full output' }));
    expect(await screen.findByText('all green')).toBeInTheDocument();
    expect(state.output).toHaveBeenCalledExactlyOnceWith('chat-1', 'bg-1');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    openMenu('agent');
    await screen.findByRole('menuitem', { name: 'Show in transcript' });
    expect(screen.queryByRole('menuitem', { name: 'Full output' })).toBeNull();
  });

  it('reports a Stop that failed', async () => {
    state.stop.mockRejectedValue(new Error('gone'));
    state.entries = [row('agent', { task, source })];
    render(<ActivitySection columnId="main" />);
    openMenu('agent');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
    await waitFor(() =>
      expect(state.toast.error).toHaveBeenCalledWith('Could not stop “agent”', { description: 'gone' }),
    );
  });
});
