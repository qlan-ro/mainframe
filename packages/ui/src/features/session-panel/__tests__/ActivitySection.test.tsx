import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useZonesStore } from '@/features/chat/zones/zones-store';
import type { ActivityEntry } from '../activity-model';
import { usePanelControl } from '../panel-control-store';

const state = vi.hoisted(() => ({
  entries: [] as ActivityEntry[],
  adapterId: 'claude',
  history: undefined as { hasMore: boolean; loading: boolean; error?: string } | undefined,
  loadEarlier: vi.fn(),
  jump: vi.fn(),
  focusRequest: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  switchTo: vi.fn(),
  openInSplit: vi.fn(),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('../use-activity-entries', () => ({
  useActivityEntries: () => ({
    entries: state.entries,
    chatId: 'chat-1',
    adapterId: state.adapterId,
    now: 600_000,
    loadError: null,
  }),
}));
vi.mock('../activity-source', () => ({ jumpToActivitySource: state.jump, focusPendingRequest: state.focusRequest }));
vi.mock('@/lib/api/background-tasks', () => ({ stopBackgroundTask: state.stop, cancelDelegatedTask: state.cancel }));
vi.mock('@/lib/toast', () => ({ mfToast: state.toast }));
vi.mock('@/features/chat/runtime/chat-extras', () => ({
  useChatExtras: () => ({ state: { historyWindow: state.history }, loadEarlier: state.loadEarlier }),
}));
vi.mock('@assistant-ui/react', () => ({ useAui: () => ({ threads: { switchToThread: state.switchTo } }) }));
vi.mock('@/features/side-chat/side-chat-scope', () => ({ useSideAwareThreadId: () => 'parent' }));
vi.mock('@/features/chat/workflow/use-workflow-run', () => ({ useWorkflowRun: () => undefined }));
vi.mock('@/features/chat/zones/open-in-split', () => ({ openInSplit: state.openInSplit }));
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
  state.jump.mockResolvedValue(true);
  state.focusRequest.mockReturnValue(true);
  state.stop.mockResolvedValue(undefined);
  state.cancel.mockResolvedValue(undefined);
  useZonesStore.setState({ subagent: null, splitFits: true });
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
    expect(state.jump).toHaveBeenCalledWith('chat-1', source);
    // The floating panel would cover the row it went to.
    expect(usePanelControl.getState().overlayOpen.main).toBe(false);
  });

  it('says so when the row is not in the loaded history', async () => {
    state.jump.mockResolvedValue(false);
    state.entries = [row('r', { kind: 'monitor', source })];
    render(<ActivitySection columnId="main" />);
    clickRow('r');
    await waitFor(() => expect(state.toast.info).toHaveBeenCalledWith('“r” started before the history shown here'));
  });

  it('opens a sub-agent’s transcript beside the chat', () => {
    state.entries = [row('agent', { source, task })];
    render(<ActivitySection columnId="main" />);
    clickRow('agent');
    expect(useZonesStore.getState().subagent).toEqual({
      parentChatId: 'chat-1',
      parentThreadId: 'parent',
      toolCallId: 'call-1',
      messageId: 'message-1',
      title: 'agent',
    });
    expect(state.jump).not.toHaveBeenCalled();
  });

  it('goes to the sub-agent’s row when there is no room beside the chat', () => {
    useZonesStore.setState({ splitFits: false });
    state.entries = [row('agent', { source, task })];
    render(<ActivitySection columnId="main" />);
    clickRow('agent');
    expect(useZonesStore.getState().subagent).toBeNull();
    expect(state.jump).toHaveBeenCalled();
  });

  it('opens a delegated task’s chat', () => {
    state.entries = [row('task', { kind: 'delegated', delegated: { taskId: 't-1', itemId: 'child' } as never })];
    render(<ActivitySection columnId="main" />);
    clickRow('task');
    expect(state.openInSplit).toHaveBeenCalledWith('parent', 'child');
    expect(state.switchTo).toHaveBeenCalledWith('child');
  });

  it('a sub-agent that needs you takes focus to its request', () => {
    state.entries = [row('agent', { state: 'needs-you', source, task })];
    render(<ActivitySection columnId="main" />);
    clickRow('agent');
    expect(state.focusRequest).toHaveBeenCalledWith('chat-1');
    expect(useZonesStore.getState().subagent).toBeNull();
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
