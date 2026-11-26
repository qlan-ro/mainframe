/** Another agent's transcript inside its row: nothing it holds may be lost (T1c, T1f). */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TurnFixture, assistant, bash, failed, running, system, text, tool, user } from './fixtures';
import { AgentSteps, type AgentStepsProps } from '../AgentSteps';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn().mockResolvedValue([]),
  readBackgroundTaskOutput: vi.fn().mockResolvedValue(''),
}));

// The task's own chat has no daemon here; its row and its Result are the real ones.
vi.mock('../../../orchestration/TaskChatSteps', async () => {
  const { AgentSteps: Steps } = await import('../AgentSteps');
  return {
    TaskChatSteps: ({ chatId, ...props }: AgentStepsProps & { chatId: string }) => (
      <Steps {...props} chatId={chatId} messages={[]} />
    ),
  };
});

let roots = 0;
beforeEach(() => roots++);

function show(messages: readonly ThreadMessage[], props: Partial<AgentStepsProps> = {}) {
  return render(
    <TurnFixture rootId={`steps-${roots}`} messages={[user('Go'), assistant([text('Host')], 'host')]}>
      <TooltipProvider>
        <div data-testid="agent">
          <AgentSteps messages={messages} messageId="host" toolCallId="agent" outcome="done" {...props} />
        </div>
      </TooltipProvider>
    </TurnFixture>,
  );
}
const agent = () => within(screen.getByTestId('agent'));
const PROMPT = 'Review the diff';

it('shows the prompt once, its steps and its answer', () => {
  show([user(PROMPT, 'p'), assistant([bash('b', 'git diff'), text('Looks right.')], 'a')], { prompt: PROMPT });
  expect(agent().getAllByText(PROMPT)).toHaveLength(1);
  expect(agent().getByTestId('chat-agent-prompt')).toHaveTextContent(PROMPT);
  expect(agent().getByTestId('chat-row-b')).toBeVisible();
  expect(agent().getByTestId('chat-agent-result')).toHaveTextContent('ResultLooks right.');
  expect(agent().getAllByText('Looks right.')).toHaveLength(1);
});

it('shows the error its transcript ended on', () => {
  show([user(PROMPT, 'p'), assistant([text('Boom')], 'e', { custom: { errorText: 'Provider disconnected' } })], {
    prompt: PROMPT,
    outcome: 'failed',
  });
  expect(agent().getByTestId('chat-error-block')).toHaveTextContent('Provider disconnected');
});

it('shows system messages: a compaction, and plain text', () => {
  const said = { ...system('s2', {}), content: [{ type: 'text', text: 'Switched to plan mode' }] } as ThreadMessage;
  show([user(PROMPT, 'p'), system('s1', { isCompacted: true }), said], { prompt: PROMPT });
  expect(agent().getByTestId('chat-compaction-pill')).toBeVisible();
  expect(agent().getByText('Switched to plan mode')).toBeVisible();
});

it('shows a follow-up with its picture and its attachments', () => {
  const image = 'data:image/png;base64,AA';
  const followUp = {
    ...user('And this one', 'f'),
    content: [
      { type: 'text', text: 'And this one' },
      { type: 'image', image },
    ],
    attachments: [
      {
        id: 'att',
        type: 'document',
        name: 'notes.txt',
        contentType: 'text/plain',
        status: { type: 'complete' },
        content: [],
      },
    ],
  } as unknown as ThreadMessage;
  show([user(PROMPT, 'p'), assistant([text('Done.')], 'a'), followUp], { prompt: PROMPT });
  expect(agent().getByText('And this one')).toBeVisible();
  expect(screen.getByTestId('agent').querySelector(`img[src="${image}"]`)).not.toBeNull();
  expect(agent().getByTestId('chat-user-attachment-notes.txt')).toBeVisible();
});

it('shows a review the user sent as the card it is', () => {
  const review = user('', 'r', {
    reviewComment: { file: 'src/a.ts', comments: [{ start: 3, end: 3, code: 'x', body: 'Rename it' }] },
  });
  show([user(PROMPT, 'p'), review], { prompt: PROMPT });
  expect(agent().getByTestId('chat-user-review-comment')).toHaveTextContent('Rename it');
});

it('shows the first message of a bounded window, which is not the prompt', () => {
  show([user('Try again with the fix', 'late'), assistant([text('Ok.')], 'a')], { prompt: PROMPT });
  expect(agent().getByTestId('chat-agent-prompt')).toHaveTextContent(PROMPT);
  expect(agent().getByText('Try again with the fix')).toBeVisible();
});

it('keeps the prompt’s own message when it carries more than its text', () => {
  const pictured = {
    ...user(PROMPT, 'p'),
    content: [
      { type: 'text', text: PROMPT },
      { type: 'image', image: 'data:image/png;base64,BB' },
    ],
  } as unknown as ThreadMessage;
  show([pictured, assistant([text('Ok.')], 'a')], { prompt: PROMPT });
  expect(screen.getByTestId('agent').querySelector('img[src="data:image/png;base64,BB"]')).not.toBeNull();
});

it('reads a task prompt through the marker the daemon wraps it in', () => {
  const wrapped = `<mainframe-agent-message from="parent" kind="task">\n${PROMPT}\n</mainframe-agent-message>`;
  show([user(wrapped, 'p'), assistant([text('Ok.')], 'a')], { prompt: PROMPT });
  expect(agent().getAllByText(PROMPT)).toHaveLength(1);
  expect(screen.getByTestId('agent')).not.toHaveTextContent('mainframe-agent-message');
});

const result = (task: string) =>
  `<mainframe-task-result task="${task}" chat="kid" status="completed">\nNo races.\n</mainframe-task-result>`;

it('shows a task result delivered to the agent as a line, never its markup', () => {
  show([user(PROMPT, 'p'), user(result('t1'), 'r'), assistant([text('Ok.')], 'a')], { prompt: PROMPT });
  expect(screen.getByTestId('agent')).not.toHaveTextContent('mainframe-task-result');
  fireEvent.click(agent().getByTestId('chat-task-result-t1'));
  expect(agent().getByText('No races.')).toBeVisible();
});

it('does not draw a result’s markup as the prompt of a window without one', () => {
  show([user(result('t1'), 'r'), assistant([text('Ok.')], 'a')]);
  expect(screen.getByTestId('agent')).not.toHaveTextContent('mainframe-task-result');
  expect(agent().getByTestId('chat-task-result-t1')).toBeVisible();
});

it('shows a result in the row of the task it belongs to, and nowhere else', async () => {
  const task = tool({
    toolCallId: 'kid',
    toolName: 'mcp__mainframe__delegate_task',
    args: { task: 'Race review' },
    result: JSON.stringify({ taskId: 't1', childChatId: 'kid-chat', status: 'running' }),
  });
  show([user(PROMPT, 'p'), assistant([task], 'a'), user(result('t1'), 'r'), assistant([text('Ok.')], 'a2')], {
    prompt: PROMPT,
  });
  expect(agent().queryByTestId('chat-task-result-t1')).toBeNull();
  expect(agent().queryByText('No races.')).toBeNull();
  fireEvent.click(agent().getByTestId('chat-tool-delegate-task-card-toggle'));
  expect(await agent().findByText('No races.')).toBeVisible();
});

it('shows a skill’s text in its marker, once', () => {
  const skill = { skillName: 'design', path: '/s/SKILL.md', content: '# Design' };
  const call = tool({ toolCallId: 'sk', toolName: 'Skill', args: { skill: 'design' }, result: 'ok' });
  show([user(PROMPT, 'p'), assistant([call], 'a'), system('s', { skillLoaded: skill })], { prompt: PROMPT });
  expect(agent().queryByTestId('chat-skill-loaded-pill')).toBeNull();
  fireEvent.click(agent().getByTestId('chat-marker-skill'));
  expect(agent().getByTestId('chat-skill-content')).toHaveTextContent('# Design');
});

it('has no result while the agent works: its words are steps', () => {
  show([user(PROMPT, 'p'), assistant([bash('b', 'ls'), text('Now the tests.')], 'a')], {
    prompt: PROMPT,
    outcome: 'going',
  });
  expect(agent().queryByTestId('chat-agent-result')).toBeNull();
  expect(agent().getByTestId('chat-step-text')).toHaveTextContent('Now the tests.');
});

it('keeps what it brought back before while it works again', () => {
  show([user('More', 'late'), assistant([text('On it.')], 'a')], {
    prompt: PROMPT,
    outcome: 'going',
    result: 'No races.',
  });
  expect(agent().getByTestId('chat-agent-result')).toHaveTextContent('Earlier resultNo races.');
});

it('keeps what it brought back before though its words now only contain it', () => {
  show([user('More', 'late'), assistant([text('Not Done yet.')], 'a')], {
    prompt: PROMPT,
    outcome: 'going',
    result: 'Done',
  });
  expect(agent().getByTestId('chat-agent-result').textContent).toBe('Earlier resultDone');
});

it.each([
  ['failed', 'Error'],
  ['stopped', 'Result'],
] as const)('keeps both its last words and what came back when it %s', (outcome, label) => {
  show([user(PROMPT, 'p'), assistant([text('Halfway there.')], 'a')], {
    prompt: PROMPT,
    outcome,
    result: 'Out of budget',
  });
  expect(agent().getByText('Halfway there.')).toBeVisible();
  expect(agent().getByTestId('chat-agent-result')).toHaveTextContent(`${label}Out of budget`);
});

it('keeps a result that differs from its last words', () => {
  show([user(PROMPT, 'p'), assistant([text('See above.')], 'a')], { prompt: PROMPT, result: 'Two races found.' });
  expect(agent().getByText('See above.')).toBeVisible();
  expect(agent().getByTestId('chat-agent-result')).toHaveTextContent('Two races found.');
});

it.each([
  ['Done.', 'Done. Also: 3 tests FAILED'],
  ['Done', 'Not Done: 3 tests FAILED'],
  ['Not Done: 3 tests FAILED', 'Done'],
  ['Done: see the log', 'Done'],
])('never hides what was delivered: it last said “%s”, and “%s” came back', (said, result) => {
  show([user(PROMPT, 'p'), assistant([bash('b', 'ls'), text(said)], 'a')], { prompt: PROMPT, result });
  expect(agent().getByTestId('chat-agent-result').textContent).toBe(`Result${result}`);
});

it('repeats its last words once when they begin, or are, what came back', () => {
  const view = show([user(PROMPT, 'p'), assistant([text('All good.')], 'a')], {
    prompt: PROMPT,
    result: 'All good.\n\nagentId: 1',
  });
  expect(screen.getByTestId('agent').textContent!.match(/All good\./g)).toHaveLength(1);
  view.unmount();
  show([user(PROMPT, 'p'), assistant([text('First.'), text('All good.')], 'a')], {
    prompt: PROMPT,
    result: 'All good.',
  });
  expect(screen.getByTestId('agent').textContent!.match(/All good\./g)).toHaveLength(1);
  expect(agent().getByTestId('chat-agent-result')).toHaveTextContent('First.');
});

it('offers the whole of a result the daemon cut short, though its last words begin it', () => {
  show([user(PROMPT, 'p'), assistant([text('All good.')], 'a')], {
    prompt: PROMPT,
    result: 'All good. More',
    resultBody: <button>Show full output</button>,
  });
  expect(agent().getByRole('button', { name: 'Show full output' })).toBeVisible();
});

it('keeps a picture it answered with', () => {
  const picture = { type: 'image', image: 'data:image/png;base64,CC' } as const;
  show([user(PROMPT, 'p'), assistant([bash('b', 'plot'), text('Here it is.'), picture], 'a')], { prompt: PROMPT });
  fireEvent.click(agent().getAllByTestId(/^chat-image-a-\d+-toggle$/)[0]!);
  expect(screen.getByTestId('agent').querySelector('img[src="data:image/png;base64,CC"]')).not.toBeNull();
});

it.each([
  ['stopped', 'stopped'],
  ['done', 'no result'],
  ['failed', 'no result'],
  ['unknown', 'no result'],
] as const)('reads a step with no outcome of an agent that is %s as “%s”', (outcome, word) => {
  const messages = [user(PROMPT, 'p'), assistant([bash('b', 'sleep 60', running)], 'a')];
  show(messages, { prompt: PROMPT, outcome });
  expect(agent().getByTestId('chat-row-b-receipt')).toHaveTextContent(word);
  expect(screen.getByTestId('agent').querySelector('.animate-spin')).toBeNull();
});

it('claims no answer for an agent nothing says ended', () => {
  show([user(PROMPT, 'p'), assistant([bash('b', 'ls'), text('Halfway there.')], 'a')], {
    prompt: PROMPT,
    outcome: 'unknown',
  });
  expect(agent().getByText('Halfway there.')).toBeVisible();
  expect(agent().queryByTestId('chat-agent-result')).toBeNull();
});

it('reads a step with no outcome as stopped once the agent is, and as running while it works', () => {
  const going = { result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } } as const;
  const messages = [user(PROMPT, 'p'), assistant([bash('b', 'sleep 60', going)], 'a')];
  const view = show(messages, { prompt: PROMPT, outcome: 'stopped' });
  expect(agent().getByTestId('chat-row-b-receipt')).toHaveTextContent('stopped');
  expect(screen.getByTestId('agent').querySelector('.animate-spin')).toBeNull();
  view.unmount();
  show(messages, { prompt: PROMPT, outcome: 'going' });
  expect(screen.getByTestId('agent').querySelector('.animate-spin')).not.toBeNull();
});

it('opens a failed step of its own on its error', () => {
  show([user(PROMPT, 'p'), assistant([bash('b', 'vitest', failed), text('Hm.')], 'a')], { prompt: PROMPT });
  expect(agent().getByTestId('chat-bash-output')).toHaveTextContent('boom');
  fireEvent.click(agent().getByTestId('chat-row-b-toggle'));
  expect(agent().queryByTestId('chat-bash-output')).toBeNull();
});

it('opens no path menu of its own: its row’s message has one', () => {
  show([user(PROMPT, 'p'), assistant([bash('b', 'ls'), text('Ok.')], 'a')], { prompt: PROMPT });
  expect(agent().queryByTestId('chat-message-menu-trigger')).toBeNull();
  expect(screen.getAllByTestId('chat-message-menu-trigger')).toHaveLength(1);
});

it('shows its steps alone where what was asked and what came back are shown around them', () => {
  const messages = [user(PROMPT, 'p'), assistant([bash('b', 'git diff'), text('Looks right.')], 'a')];
  const bare = { bare: true, prompt: PROMPT } as const;
  const view = show(messages, { ...bare, result: 'Looks right.' });
  expect(agent().queryByText(PROMPT)).toBeNull();
  expect(agent().getByTestId('chat-row-b')).toBeVisible();
  expect(agent().queryByTestId('chat-agent-result')).toBeNull();
  // Said once: the result around the steps is these very words.
  expect(agent().queryByText('Looks right.')).toBeNull();
  view.unmount();
  show(messages, { ...bare, result: 'Two races found.' });
  expect(agent().getByText('Looks right.')).toBeVisible();
  expect(agent().queryByText('Two races found.')).toBeNull();
});

it.each(['Looks right. And more', ''])('keeps its last words among its steps when “%s” came back', (result) => {
  show([user(PROMPT, 'p'), assistant([text('Looks right.')], 'a')], { bare: true, prompt: PROMPT, result });
  expect(agent().getByText('Looks right.')).toBeVisible();
});
