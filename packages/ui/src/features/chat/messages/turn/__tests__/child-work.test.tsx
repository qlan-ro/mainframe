/** Child work holds its turn open (T1e), over the real transcript. */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ThreadMessage, ToolCallMessagePart } from '@assistant-ui/react';
import { buildChatExtras } from '../../../runtime/chat-extras';
import { createChatThreadState } from '../../../controller/chat-thread-state';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import { listBackgroundTasks } from '@/lib/api/background-tasks';
import { useUiPrefs } from '@/store/ui-prefs';
import { TurnFixture, assistant, bash, running, text, tool, user } from './fixtures';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn(),
  readBackgroundTaskOutput: vi.fn().mockResolvedValue({ text: 'output so far', truncated: false }),
}));

// The task's own chat has no daemon here; its row and its Result are the real ones.
vi.mock('../../../orchestration/TaskChatSteps', () => ({ TaskChatSteps: () => <div data-testid="task-steps" /> }));

const agent = (overrides: Partial<ToolCallMessagePart> = {}) =>
  tool({
    toolCallId: 'agent',
    toolName: 'Task',
    args: { subagent_type: 'code-reviewer', description: 'Review the diff', prompt: 'Review it' },
    result: 'Looks right.',
    messages: [
      user('Review it', 'p'),
      assistant([bash('inner', 'git diff'), text('Looks right.')], 'inner-message'),
    ] as ThreadMessage[],
    ...overrides,
  });

function extrasWith(backgroundTasks: Record<string, object>) {
  const state = createChatThreadState('chat-fixture');
  return buildChatExtras({} as AcpChatController, 31415, { ...state, backgroundTasks } as typeof state);
}
const background = { bg: { id: 'bg', kind: 'agent', description: 'x', startedAt: 1 } };
const header = () => screen.getByTestId(/^chat-work-toggle-/);
const isOpen = () => header().getAttribute('aria-expanded') === 'true';
let roots = 0;

beforeEach(() => {
  useUiPrefs.setState({ finishedWork: 'fold' });
  vi.mocked(listBackgroundTasks).mockReset().mockResolvedValue([]);
  roots++;
});

it('folds a turn whose agents have finished, and still names them', () => {
  render(<TurnFixture rootId={`cw-${roots}`} messages={[user('Hi'), assistant([agent(), text('Done')])]} />);
  expect(isOpen()).toBe(false);
  expect(header()).toHaveAccessibleName('Worked, 1 agent');
  expect(screen.getByRole('button', { name: '1 agent: show it' })).toHaveTextContent('1 agent');
});

it('stays open, with a live count, while an agent runs in the background', async () => {
  vi.mocked(listBackgroundTasks).mockResolvedValue([
    { id: 'bg', kind: 'agent', toolUseId: 'agent', status: 'running', startedAt: 1 },
  ] as never);
  const messages = [user('Hi'), assistant([agent({ result: 'Async agent launched successfully.' }), text('Started')])];
  const view = render(<TurnFixture rootId={`cw-${roots}`} messages={messages} extras={extrasWith(background)} />);
  expect(isOpen()).toBe(true);
  await waitFor(() => expect(header()).toHaveAccessibleName('Still going: Worked, 1 agent · 1 running'));
  expect(isOpen()).toBe(true);
  expect(within(screen.getByTestId('chat-row-agent')).getByTestId('chat-row-agent-receipt')).toHaveTextContent(
    'running',
  );

  view.rerender(<TurnFixture rootId={`cw-${roots}`} messages={messages} extras={extrasWith({})} />);
  await waitFor(() => expect(isOpen()).toBe(false));
});

it('counts an agent that waits on you first', async () => {
  const waiting = agent({
    ...running,
    messages: [assistant([bash('inner', 'rm x', running)], 'm')] as ThreadMessage[],
  });
  render(
    <TurnFixture
      rootId={`cw-${roots}`}
      messages={[user('Hi'), assistant([waiting], 'a', { running: true })]}
      pending={['inner']}
    />,
  );
  expect(await screen.findByRole('button', { name: '1 agent · 1 needs you: show the one still going' })).toBeVisible();
});

it('names several agents, and several still going, in the plural', async () => {
  const other = { toolCallId: 'other' } as const;
  const messages = (over: object) => [user('Hi'), assistant([agent(over), agent({ ...over, ...other })], 'a')];
  const view = render(<TurnFixture rootId={`cw-${roots}`} messages={messages({})} isRunning={false} />);
  expect(screen.getByRole('button', { name: '2 agents: show them' })).toBeVisible();
  view.rerender(<TurnFixture rootId={`cw-${roots}`} messages={messages(running)} isRunning />);
  expect(await screen.findByRole('button', { name: '2 agents · 2 running: show the ones still going' })).toBeVisible();
});

it('opens the turn on its agent', async () => {
  Element.prototype.scrollIntoView = vi.fn();
  render(<TurnFixture rootId={`cw-${roots}`} messages={[user('Hi'), assistant([agent(), text('Done')])]} />);
  fireEvent.click(screen.getByRole('button', { name: '1 agent: show it' }));
  await waitFor(() => expect(screen.getByTestId('chat-row-agent-toggle')).toHaveFocus());
  expect(screen.getByTestId('chat-row-agent')).toHaveAttribute('data-activity-flash');
});

it('shows an agent’s prompt, its steps as rows and its answer', () => {
  render(<TurnFixture rootId={`cw-${roots}`} messages={[user('Hi'), assistant([agent(), text('Done')])]} />);
  fireEvent.click(header());
  fireEvent.click(screen.getByTestId('chat-row-agent-toggle'));
  expect(screen.getByTestId('chat-agent-prompt')).toHaveTextContent('Review it');
  expect(screen.getByTestId('chat-row-inner')).toHaveTextContent('git diff');
  expect(screen.getByTestId('chat-agent-result')).toHaveTextContent('Looks right.');
});

it('keeps the same call in two agents apart', () => {
  const inner = (id: string) =>
    agent({ toolCallId: id, messages: [assistant([bash('same', `echo ${id}`)], 'm')] as ThreadMessage[] });
  render(
    <TurnFixture
      rootId={`cw-${roots}`}
      messages={[user('Hi'), assistant([inner('one'), inner('two'), text('Done')])]}
    />,
  );
  fireEvent.click(header());
  fireEvent.click(screen.getByTestId('chat-row-one-toggle'));
  fireEvent.click(screen.getByTestId('chat-row-two-toggle'));
  const [first, second] = screen.getAllByTestId('chat-row-same-toggle');
  fireEvent.click(first!);
  expect(first).toHaveAttribute('aria-expanded', 'true');
  expect(second).toHaveAttribute('aria-expanded', 'false');
});

it('shows a background command as running and its output in its row', async () => {
  vi.mocked(listBackgroundTasks).mockResolvedValue([
    { id: 'bg', kind: 'bash', toolUseId: 'cmd', status: 'running', startedAt: Date.now() },
  ] as never);
  const command = bash('cmd', 'pnpm dev', {
    args: { command: 'pnpm dev', run_in_background: true },
    result: 'Started bg',
  });
  render(
    <TurnFixture
      rootId={`cw-${roots}`}
      messages={[user('Hi'), assistant([command, text('Started')])]}
      extras={extrasWith({ bg: { id: 'bg', kind: 'bash', description: 'x', startedAt: 1 } })}
    />,
  );
  // A background command does not hold its turn open (T1e).
  expect(isOpen()).toBe(false);
  fireEvent.click(header());
  await waitFor(() => expect(screen.getByTestId('chat-row-cmd')).toHaveTextContent(/Running/));
  fireEvent.click(screen.getByTestId('chat-row-cmd-toggle'));
  expect(await screen.findByTestId('chat-bash-output')).toHaveTextContent('output so far');
  await act(async () => {});
});

it('reads the output of a finished command the CLI moved to the background itself', async () => {
  vi.mocked(listBackgroundTasks).mockResolvedValue([
    { id: 'bg', kind: 'bash', toolUseId: 'cmd', status: 'completed', startedAt: 1 },
  ] as never);
  const launch = 'Command running in background with ID: bg. Output is being written to: /tmp/bg.output';
  render(
    <TurnFixture
      rootId={`cw-${roots}`}
      messages={[user('Hi'), assistant([bash('cmd', 'pnpm test', { result: launch }), text('Started')])]}
      extras={extrasWith({})}
    />,
  );
  fireEvent.click(header());
  expect(screen.getByTestId('chat-row-cmd-receipt')).toHaveTextContent('in the background');
  fireEvent.click(screen.getByTestId('chat-row-cmd-toggle'));
  expect(await screen.findByText('output so far')).toBeVisible();
  await act(async () => {});
});

it.each([
  ['stopped', 'stopped', 'Stopped'],
  ['failed', 'failed', 'Failed'],
] as const)('reads a background agent that %s after its call as that, never as done', async (status, word, name) => {
  vi.mocked(listBackgroundTasks).mockResolvedValue([
    { id: 'bg', kind: 'agent', toolUseId: 'agent', status, startedAt: 1 },
  ] as never);
  const launched = agent({ result: 'Async agent launched successfully.' });
  render(
    <TurnFixture
      rootId={`cw-${roots}`}
      messages={[user('Hi'), assistant([launched, text('Started')])]}
      extras={extrasWith({})}
    />,
  );
  fireEvent.click(header());
  await waitFor(() => expect(screen.getByTestId('chat-row-agent-receipt')).toHaveTextContent(word));
  expect(screen.getByTestId('chat-row-agent')).toHaveTextContent(`${name}: code-reviewer`);
  if (status === 'failed') expect(header()).toHaveAccessibleName(/1 failed/);
});

it('asks how the last background agent ended, once nothing runs', async () => {
  const running = { id: 'bg', kind: 'agent', toolUseId: 'agent', status: 'running', startedAt: 1 };
  vi.mocked(listBackgroundTasks).mockResolvedValue([running] as never);
  const messages = [user('Hi'), assistant([agent({ result: 'Async agent launched successfully.' }), text('Started')])];
  const view = render(<TurnFixture rootId={`cw-${roots}`} messages={messages} extras={extrasWith(background)} />);
  await waitFor(() => expect(header()).toHaveAccessibleName(/Still going/));
  vi.mocked(listBackgroundTasks).mockResolvedValue([{ ...running, status: 'stopped' }] as never);
  view.rerender(<TurnFixture rootId={`cw-${roots}`} messages={messages} extras={extrasWith({})} />);
  await waitFor(() => expect(isOpen()).toBe(false));
  fireEvent.click(header());
  await waitFor(() => expect(screen.getByTestId('chat-row-agent-receipt')).toHaveTextContent('stopped'));
});

it('opens a delegated task that failed by itself, and only that one', async () => {
  const task = (id: string, status: string) =>
    tool({
      toolCallId: id,
      toolName: 'mcp__mainframe__delegate_task',
      args: { task: id },
      result: JSON.stringify({ taskId: `t-${id}`, childChatId: `kid-${id}`, status }),
    });
  render(
    <TurnFixture
      rootId={`cw-${roots}`}
      messages={[user('Hi'), assistant([task('bad', 'failed'), task('good', 'completed'), text('Done')])]}
    />,
  );
  expect(header()).toHaveAccessibleName(/1 failed/);
  fireEvent.click(header());
  const [bad, good] = screen.getAllByTestId('chat-tool-delegate-task-card-toggle');
  expect(bad).toHaveAttribute('aria-expanded', 'true');
  expect(good).toHaveAttribute('aria-expanded', 'false');
  expect(await screen.findByTestId('task-steps')).toBeVisible();
});

it('names the model an agent ran on in its row, when the call chose one', () => {
  const args = { subagent_type: 'code-reviewer', prompt: 'Review it' };
  render(
    <TurnFixture
      rootId={`cw-${roots}`}
      messages={[
        user('Hi'),
        assistant([agent({ args: { ...args, model: 'opus' } }), agent({ toolCallId: 'plain', args }), text('Done')]),
      ]}
    />,
  );
  fireEvent.click(header());
  fireEvent.click(screen.getByTestId('chat-row-agent-toggle'));
  expect(screen.getByTestId('chat-agent-model')).toHaveTextContent('Model opus');
  fireEvent.click(screen.getByTestId('chat-row-plain-toggle'));
  expect(screen.getAllByTestId('chat-agent-model')).toHaveLength(1);
});

it('holds nothing open for an agent whose session was killed', () => {
  render(
    <TurnFixture
      rootId={`cw-${roots}`}
      messages={[user('Hi'), assistant([text('On it'), agent(running), text('Hm')])]}
    />,
  );
  expect(isOpen()).toBe(false);
  expect(header()).not.toHaveAccessibleName(/running|Still going/);
  fireEvent.click(header());
  expect(screen.getByTestId('chat-row-agent-receipt')).toHaveTextContent('stopped');
  expect(screen.getByTestId('chat-row-agent').querySelector('.animate-spin')).toBeNull();
});
