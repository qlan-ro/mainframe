import { buildChatExtras } from '../../../runtime/chat-extras';
import { createChatThreadState } from '../../../controller/chat-thread-state';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import { listBackgroundTasks } from '@/lib/api/background-tasks';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { TurnFixture, assistant, bash, failed, tool, user } from './fixtures';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn(),
  readBackgroundTaskOutput: vi.fn().mockResolvedValue({ text: 'output so far', truncated: false }),
}));

// The task's own chat has no daemon here; its row and its Result are the real ones.
vi.mock('../../../orchestration/TaskChatSteps', () => ({ TaskChatSteps: () => <div data-testid="task-steps" /> }));

function extrasWith(backgroundTasks: Record<string, object>) {
  const state = createChatThreadState('chat-fixture');
  return buildChatExtras({} as AcpChatController, 31415, { ...state, backgroundTasks } as typeof state);
}
const background = { bg: { id: 'bg', kind: 'agent', description: 'x', startedAt: 1 } };
const header = () => screen.getByTestId(/^chat-work-toggle-/);

const row = (id: string) => screen.getByTestId(`chat-row-${id}-toggle`);

beforeEach(() => useUiPrefs.setState({ finishedWork: 'open' }));

it('keeps six different failures closed after later successes and still counts all six', () => {
  const failures = Array.from({ length: 6 }, (_, i) => bash(`bad-${i}`, `check ${i}`, failed));
  render(
    <TurnFixture
      rootId="moved-on"
      messages={[user('Hi'), assistant([...failures, bash('one', 'ls'), bash('two', 'pwd')])]}
    />,
  );
  expect(screen.getByRole('button', { name: '6 failed: show the failed step' })).toBeVisible();
  for (const failure of failures) expect(row(failure.toolCallId)).toHaveAttribute('aria-expanded', 'false');
});

it('opens only the last of two consecutive failures', () => {
  const steps = [bash('first', 'ls', failed), bash('last', 'pwd', failed)];
  render(<TurnFixture rootId="two-failures" messages={[user('Hi'), assistant(steps)]} />);
  expect(row('first')).toHaveAttribute('aria-expanded', 'false');
  expect(row('last')).toHaveAttribute('aria-expanded', 'true');
});

it('preserves manual open and close choices when the live turn ends', () => {
  const steps = [bash('manual', 'ls', failed), bash('closed', 'pwd', failed), bash('last', 'git status', failed)];
  const messages = [user('Hi'), assistant(steps)];
  const view = render(<TurnFixture rootId="manual" messages={messages} isRunning />);
  expect(row('last')).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(row('manual'));
  fireEvent.click(row('last'));
  fireEvent.click(row('last'));
  view.rerender(<TurnFixture rootId="manual" messages={messages} isRunning={false} />);
  expect(row('manual')).toHaveAttribute('aria-expanded', 'true');
  expect(row('closed')).toHaveAttribute('aria-expanded', 'false');
  expect(row('last')).toHaveAttribute('aria-expanded', 'false');
});

const delegatedLaunch = () =>
  tool({
    toolCallId: 'task',
    toolName: 'mcp__mainframe__delegate_task',
    args: { task: 'Do the check' },
    result: JSON.stringify({ taskId: 't', childChatId: 'kid', status: 'running' }),
  });

const taskResult = (status: string) =>
  user(`<mainframe-task-result task="t" chat="kid" status="${status}">Done</mainframe-task-result>`, 'delivered');

it('opens Bash when a later delegated launch ends cancelled', () => {
  useUiPrefs.setState({ finishedWork: 'open' });
  const messages = [user('Hi'), assistant([bash('bash', 'ls', failed), delegatedLaunch()]), taskResult('cancelled')];
  render(<TurnFixture rootId={'stopped-delegation'} messages={messages} />);
  expect(screen.getByTestId('chat-row-bash-toggle')).toHaveAttribute('aria-expanded', 'true');
});

it('keeps Bash closed after a later async sub-agent completes', async () => {
  useUiPrefs.setState({ finishedWork: 'open' });
  const task = { id: 'bg', kind: 'agent', toolUseId: 'agent', status: 'running', startedAt: 1 };
  vi.mocked(listBackgroundTasks).mockResolvedValue([task] as never);
  const messages = [
    user('Hi'),
    assistant([
      bash('bash', 'ls', failed),
      tool({ toolCallId: 'agent', toolName: 'Task', result: 'Async agent launched successfully.' }),
    ]),
  ];
  const view = render(<TurnFixture rootId={'async-completion'} messages={messages} extras={extrasWith(background)} />);
  await waitFor(() => expect(header()).toHaveAccessibleName(/Still going.*1 running/));
  expect(screen.getByTestId('chat-row-bash-toggle')).toHaveAttribute('aria-expanded', 'false');

  vi.mocked(listBackgroundTasks).mockResolvedValue([{ ...task, status: 'completed' }] as never);
  view.rerender(<TurnFixture rootId={'async-completion'} messages={messages} extras={extrasWith({})} />);
  await waitFor(() => expect(header()).not.toHaveAccessibleName(/Still going/));
  expect(screen.getByTestId('chat-row-bash-toggle')).toHaveAttribute('aria-expanded', 'false');
});

it('keeps its automatic choice when a later child failure arrives and an older page changes the turn key', async () => {
  useUiPrefs.setState({ finishedWork: 'open' });
  const props = { rootId: 'late-child-result' };
  const tail = assistant([bash('bash', 'ls', failed)]);
  const launch = assistant([delegatedLaunch()], 'launch');
  const view = render(<TurnFixture {...props} messages={[tail]} />);
  expect(screen.getByTestId('chat-row-bash-toggle')).toHaveAttribute('aria-expanded', 'true');

  view.rerender(<TurnFixture {...props} messages={[tail, launch, taskResult('failed')]} />);
  expect(screen.getByTestId('chat-row-bash-toggle')).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() =>
    expect(screen.getByTestId('chat-tool-delegate-task-card-toggle')).toHaveAttribute('aria-expanded', 'false'),
  );

  view.unmount();
  render(
    <TurnFixture
      {...props}
      messages={[user('Hi'), assistant([bash('older', 'pwd')], 'older'), { ...tail }, launch, taskResult('failed')]}
    />,
  );
  expect(screen.getByTestId('chat-row-bash-toggle')).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() =>
    expect(screen.getByTestId('chat-tool-delegate-task-card-toggle')).toHaveAttribute('aria-expanded', 'false'),
  );
});

it.each([
  [failed, 'true'],
  [{}, 'false'],
] as const)('uses a finished sub-agent’s final step to decide what opens (%o)', (ending, open) => {
  const messages = [
    user('Review the diff', 'prompt'),
    assistant([bash('earlier', 'ls', failed)], 'first'),
    assistant([bash('later', 'pwd', ending)], 'second'),
  ];
  const task = tool({ toolCallId: 'inner-agent', toolName: 'Task', result: 'Done', messages });
  render(<TurnFixture rootId={`inner-agent-${open}`} messages={[user('Hi'), assistant([task])]} />);
  fireEvent.click(row('inner-agent'));
  expect(row('earlier')).toHaveAttribute('aria-expanded', 'false');
  expect(row('later')).toHaveAttribute('aria-expanded', open);
});

it.each([
  ['completed', 'false'],
  ['cancelled', 'true'],
])('waits for the unlisted delegation to settle as %s', async (status, expanded) => {
  const messages = [user('Hi'), assistant([bash('bash', 'ls', failed), delegatedLaunch()])];
  const rootId = `unlisted-${status}`;
  const view = render(<TurnFixture rootId={rootId} messages={messages} />);
  expect(row('bash')).toHaveAttribute('aria-expanded', 'false');
  view.rerender(<TurnFixture rootId={rootId} messages={[...messages, taskResult(status)]} />);
  const receipt = status === 'completed' ? 'completed' : 'stopped';
  await waitFor(() => expect(screen.getByTestId('chat-tool-delegate-task-card')).toHaveTextContent(receipt));
  expect(row('bash')).toHaveAttribute('aria-expanded', expanded);
});

it('keeps a launch acknowledgment in the retry count and opens the earlier failure after cancellation', () => {
  const failedLaunch = { ...delegatedLaunch(), ...failed, toolCallId: 'failed-task' };
  const messages = [user('Hi'), assistant([failedLaunch, delegatedLaunch()]), taskResult('cancelled')];
  render(<TurnFixture rootId="retry-launch" messages={messages} />);
  expect(header()).toHaveAccessibleName(/1 failed, retried/);
  expect(within(screen.getAllByTestId('chat-tool-delegate-task-card')[0]!).getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});
