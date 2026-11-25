/** Stop in an agent's and a delegated task's row (T1c): for what its tab and the panel can stop, and that only. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { buildChatExtras } from '../../../runtime/chat-extras';
import { createChatThreadState } from '../../../controller/chat-thread-state';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import { cancelDelegatedTask, listBackgroundTasks, stopBackgroundTask } from '@/lib/api/background-tasks';
import { useUiPrefs } from '@/store/ui-prefs';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { TurnFixture, assistant, running, text, tool, user } from './fixtures';

const { sessions, toast } = vi.hoisted(() => ({
  sessions: { items: [] as unknown[] },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/toast', () => ({ mfToast: toast }));
vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn(),
  readBackgroundTaskOutput: vi.fn(),
  stopBackgroundTask: vi.fn(),
  cancelDelegatedTask: vi.fn(),
}));
vi.mock('../../../orchestration/TaskChatSteps', () => ({ TaskChatSteps: () => null }));
vi.mock('../../../orchestration/use-session-items', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionItems: () => sessions.items,
}));

const agent = (over: object = {}) =>
  tool({
    toolCallId: 'agent',
    toolName: 'Task',
    args: { subagent_type: 'reviewer', description: 'Review the diff', prompt: 'Look' },
    result: 'Async agent launched successfully.',
    ...over,
  });
const listed = (over: Partial<BackgroundTask> = {}) =>
  ({ id: bg(), kind: 'agent', toolUseId: 'agent', status: 'running', startedAt: 1, ...over }) as BackgroundTask;
let roots = 0;
/** A request outlives its row, so each test stops a task of its own. */
const bg = () => `bg-${roots}`;
const event = { bg: { id: 'bg', kind: 'agent', description: 'x', startedAt: 1 } };

function extrasOf(adapterId: string | undefined, backgroundTasks: object = event) {
  const state = createChatThreadState('chat-fixture');
  return buildChatExtras({} as AcpChatController, 31415, {
    ...state,
    backgroundTasks,
    chatConfig: adapterId ? { adapterId } : null,
  } as typeof state);
}

interface Scene {
  part?: ReturnType<typeof tool>;
  adapterId?: string;
  tasks?: BackgroundTask[];
  pending?: string[];
  events?: object;
}
function scene({ part = agent(), adapterId = 'claude', pending, events }: Scene) {
  return (
    <TurnFixture
      rootId={`stop-${roots}`}
      messages={[user('Hi'), assistant([part, text('Started')], 'm')]}
      extras={extrasOf(adapterId, events)}
      pending={pending}
    />
  );
}
async function show(given: Scene = {}) {
  vi.mocked(listBackgroundTasks).mockResolvedValue(given.tasks ?? [listed()]);
  const view = render(scene(given));
  await act(async () => new Promise((resolve) => setTimeout(resolve)));
  return view;
}
const stops = () => screen.queryAllByRole('button', { name: /^Stop/ });
const stop = () => screen.getByTestId('chat-task-stop-agent');

beforeEach(() => {
  roots++;
  useUiPrefs.setState({ finishedWork: 'open' });
  sessions.items = [];
  toast.success.mockClear();
  toast.error.mockClear();
  vi.mocked(stopBackgroundTask).mockReset().mockResolvedValue(undefined);
  vi.mocked(cancelDelegatedTask).mockReset().mockResolvedValue(undefined);
});

describe('a sub-agent’s row', () => {
  it('stops the task the list says runs, by its own route, in one request', async () => {
    await show();
    expect(stops()).toEqual([stop()]);
    expect(stop()).toHaveAccessibleName('Stop Review the diff');
    vi.mocked(stopBackgroundTask).mockReturnValue(new Promise(() => undefined));
    fireEvent.click(stop());
    fireEvent.click(stop());
    expect(vi.mocked(stopBackgroundTask).mock.calls).toEqual([['chat-fixture', bg()]]);
    expect(stop()).toHaveAccessibleName('Stopping Review the diff');
    expect(stop()).toHaveAttribute('aria-disabled', 'true');
  });

  it('says so once, and offers it again when it fails', async () => {
    await show();
    vi.mocked(stopBackgroundTask).mockRejectedValueOnce(new Error('gone'));
    fireEvent.click(stop());
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not stop “Review the diff”', expect.anything()),
    );
    expect(stop()).toHaveAccessibleName('Stop Review the diff');
    fireEvent.click(stop());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Stopped “Review the diff”'));
  });

  it('has one for several running tasks, and it ends the first', async () => {
    await show({ tasks: [listed({ status: 'completed', id: 'old' }), listed(), listed({ id: 'second' })] });
    expect(stops()).toHaveLength(1);
    fireEvent.click(stop());
    expect(vi.mocked(stopBackgroundTask).mock.calls).toEqual([['chat-fixture', bg()]]);
  });

  it('has one while it waits on you', async () => {
    await show({ part: agent(running), pending: ['agent'] });
    expect(stops()).toHaveLength(1);
  });

  it.each<[string, Scene]>([
    ['another CLI’s', { adapterId: 'codex' }],
    ['one whose CLI is not known', { adapterId: '' }],
    ['one that is not listed', { tasks: [], part: agent(running) }],
    ['another call’s', { tasks: [listed({ toolUseId: 'other' })] }],
    ['one that stopped', { tasks: [listed({ status: 'stopped' })] }],
    ['one that completed', { tasks: [listed({ status: 'completed' })] }],
  ])('has none for %s', async (_, given) => {
    await show(given);
    expect(screen.getByTestId('chat-row-agent')).toBeInTheDocument();
    expect(stops()).toEqual([]);
  });

  it('is reached with Tab after its row, before Open, and pressed with the keyboard', async () => {
    await show();
    screen.getByTestId('chat-row-agent-toggle').focus();
    await userEvent.tab();
    expect(stop()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(stopBackgroundTask).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chat-row-agent-toggle')).toHaveAttribute('aria-expanded', 'false');
    await userEvent.tab();
    expect(screen.getByTestId('chat-task-open-agent')).toHaveFocus();
  });

  it('leaves the focus on its row when the work ends under it', async () => {
    const view = await show();
    stop().focus();
    vi.mocked(listBackgroundTasks).mockResolvedValue([listed({ status: 'stopped' })]);
    view.rerender(scene({ events: {} }));
    await waitFor(() => expect(stops()).toEqual([]));
    expect(screen.getByTestId('chat-row-agent-toggle')).toHaveFocus();
  });

  it('keeps its request while its row is out of the document', async () => {
    await show();
    vi.mocked(stopBackgroundTask).mockReturnValue(new Promise(() => undefined));
    fireEvent.click(stop());
    const fold = screen.getByTestId(/^chat-work-toggle-/);
    fireEvent.click(fold);
    expect(screen.queryByTestId('chat-row-agent')).toBeNull();
    fireEvent.click(fold);
    expect(stop()).toHaveAccessibleName('Stopping Review the diff');
    fireEvent.click(stop());
    expect(stopBackgroundTask).toHaveBeenCalledTimes(1);
  });

  it('keeps it apart from another agent’s', async () => {
    const other = { ...agent(), toolCallId: 'other' };
    vi.mocked(listBackgroundTasks).mockResolvedValue([listed(), listed({ id: 'bg-other', toolUseId: 'other' })]);
    render(
      <TurnFixture
        rootId={`stop-${roots}`}
        messages={[user('Hi'), assistant([agent(), other, text('Started')], 'm')]}
        extras={extrasOf('claude')}
      />,
    );
    await waitFor(() => expect(stops()).toHaveLength(2));
    fireEvent.click(screen.getByTestId('chat-task-stop-other'));
    expect(vi.mocked(stopBackgroundTask).mock.calls).toEqual([['chat-fixture', 'bg-other']]);
    expect(stop()).not.toHaveAttribute('aria-disabled');
  });
});

describe('a delegated task’s row', () => {
  const id = () => `t-${roots}`;
  const part = () =>
    tool({
      toolCallId: 'task',
      toolName: 'mcp__mainframe__delegate_task',
      args: { task: 'Write the test' },
      result: JSON.stringify({ taskId: id(), childChatId: 'kid', status: 'running' }),
    });
  const kid = (status: string, over: object = {}) => {
    const delegation = { taskId: id(), role: 'review', status };
    const custom = { adapterId: 'codex', parentChatId: 'chat-fixture', delegation, hasPending: false, ...over };
    sessions.items = [
      { id: 'kid', remoteId: 'kid', title: 'Race review', status: 'regular', custom } as unknown as SessionItem,
    ];
  };
  const taskStop = () => screen.getByTestId(`chat-tool-delegate-task-stop-${id()}`);

  it.each(['running', 'waiting', 'queued'])('stops a %s task by its own route, in one request', async (status) => {
    kid(status);
    await show({ part: part(), adapterId: 'codex', events: {} });
    expect(stops()).toEqual([taskStop()]);
    expect(taskStop()).toHaveAccessibleName('Stop Race review');
    vi.mocked(cancelDelegatedTask).mockReturnValue(new Promise(() => undefined));
    fireEvent.click(taskStop());
    fireEvent.click(taskStop());
    expect(vi.mocked(cancelDelegatedTask).mock.calls).toEqual([['chat-fixture', id()]]);
    expect(taskStop()).toHaveAccessibleName('Stopping Race review');
    const fold = screen.getByTestId(/^chat-work-toggle-/);
    fireEvent.click(fold);
    fireEvent.click(fold);
    expect(taskStop()).toHaveAccessibleName('Stopping Race review');
  });

  it.each(['completed', 'failed', 'cancelled', 'interrupted'])('has none for a task that is %s', async (status) => {
    kid(status);
    await show({ part: part(), events: {} });
    expect(screen.getByTestId('chat-tool-delegate-task-card')).toBeInTheDocument();
    expect(stops()).toEqual([]);
  });

  it('has none for another task of the same chat, nor where no parent is known', async () => {
    kid('running', { delegation: { taskId: 'next', role: 'review', status: 'running' } });
    const view = await show({ part: part(), events: {} });
    expect(stops()).toEqual([]);
    view.unmount();
    kid('running', { parentChatId: undefined });
    roots++;
    await show({ part: part(), events: {} });
    expect(stops()).toEqual([]);
  });

  it('has none for a finished task whose chat goes on, nor for one that is not listed', async () => {
    kid('completed', { isRunning: true });
    const view = await show({ part: part(), events: {} });
    expect(screen.getByTestId('chat-tool-delegate-task-card-receipt')).toHaveTextContent('running');
    expect(stops()).toEqual([]);
    view.unmount();
    sessions.items = [];
    roots++;
    await show({ part: part(), events: {} });
    expect(stops()).toEqual([]);
  });
});
