/** Writing into a run: a message sent, queued, delivered or failed ends no part of it. */
import { screen } from '@testing-library/react';
import type { ThreadMessage } from '@assistant-ui/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { assistant, bash, running, text, tool, user } from './fixtures';
import {
  PROVIDERS,
  START,
  Session,
  echoed,
  idle,
  names,
  opened,
  queued,
  send,
  sendFailed,
  states,
  transcript,
} from './run-fixture';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn().mockResolvedValue([]),
  readBackgroundTaskOutput: vi.fn().mockResolvedValue({ text: '', truncated: false }),
}));

beforeEach(() => useUiPrefs.setState({ finishedWork: 'fold' }));

const going = (count: number) => {
  expect(states()).toEqual(Array(count).fill('going'));
  expect(opened()).toEqual(Array(count).fill(true));
};

describe.each(PROVIDERS)('a message sent into a run of %s', (_name, presentation) => {
  const shell = bash('b', 'pnpm test', running);
  const agent = tool({ toolCallId: 'agent', toolName: 'CollabAgent', args: { prompt: 'Look' }, ...running });
  const asked = user('Go', 'u1');
  const busy = [asked, assistant([shell, agent], 'a1', { presentation })];
  const between = [asked, assistant([bash('b', 'ls')], 'a1', { presentation })];
  const reply = (id: string, content: ThreadMessage['content']) => assistant(content as never, id, { presentation });
  const begin = async (messages: ThreadMessage[]) => {
    const session = Session.open([]);
    await session.apply(...send('first'), transcript([asked]), echoed('first'), START, transcript(messages));
    return session;
  };

  it.each([
    ['with steps that run', busy],
    ['between two steps', between],
  ])('leaves a part %s going, from the send until the reply', async (_at, started) => {
    const session = await begin(started);
    going(1);
    for (const step of [send(), [echoed(), queued()], [transcript([...started, user('x', 'u2')])], [], [START]]) {
      await session.apply(...step);
      going(1);
    }
    await session.says(...started, user('x', 'u2'), reply('a2', [bash('c', 'ls')]));
    going(2);
    expect(names()).toEqual(['Still going', 'Running']);
  });

  it.each([
    ['two steers with no reply', 2, false],
    ['two steers with a reply each', 2, true],
    ['three steers with no reply', 3, false],
    ['three steers with a reply each', 3, true],
  ])('goes on under %s', async (_count, count, replies) => {
    const session = await begin(between);
    const messages: ThreadMessage[] = [...between];
    let parts = 1;
    for (let n = 2; n < 2 + count; n++) {
      messages.push(user('x', `u${n}`));
      await session.says(...messages);
      going(parts);
      if (!replies) continue;
      messages.push(reply(`a${n}`, [bash(`s${n}`, 'ls')]));
      parts++;
      await session.says(...messages);
      going(parts);
    }
    await session.apply(...idle('end_turn'));
    expect(states()).toEqual(Array(parts).fill('finished'));
    expect(opened()).toEqual(Array(parts).fill(false));
  });

  it.each([
    ['nothing in it yet', assistant([], 'a2', { running: true })],
    ['only blank text', assistant([text(' ')], 'a2', { running: true, presentation })],
    ['a thought that has no words yet', assistant([{ type: 'reasoning', text: '' }], 'a2', { presentation })],
    ['words the provider has not placed', assistant([text('Su')], 'a2', { running: true })],
  ])('goes on under a reply with %s', async (_what, blank) => {
    const session = await begin(between);
    await session.says(...between, user('x', 'u2'), blank);
    expect(states()[0]).toBe('going');
    expect(opened()[0]).toBe(true);
  });

  it('keeps its state when the transcript is drawn again between a steer and its reply', async () => {
    const session = await begin(between);
    await session.says(...between, user('x', 'u2'));
    session.remount();
    going(1);
  });

  it('goes on under two delivered task results', async () => {
    const result = (task: string) =>
      user(`<mainframe-task-result task="${task}" status="completed" title="T">ok</mainframe-task-result>`, task);
    const session = await begin(between);
    const one = [...between, result('t1'), reply('a2', [bash('c', 'ls')])];
    await session.says(...between, result('t1'));
    going(1);
    await session.says(...one);
    going(2);
    await session.says(...one, result('t2'));
    going(2);
  });

  it('goes on when the message failed', async () => {
    const session = await begin(busy);
    await session.apply(...send(), sendFailed());
    going(1);
    await session.says(...busy, reply('a2', [bash('c', 'ls')]));
    expect(states()).toEqual(['going']);
  });

  it('never wakes a turn that had ended', async () => {
    const ended = presentation && { ...presentation, state: 'completed' as const };
    const cut = bash('cut', 'sleep 60', running);
    const done = [asked, assistant([bash('b', 'ls'), cut, text('Done')], 'a1', { presentation: ended })];
    const session = Session.open(done);
    const steps = [send(), [transcript([...done, user('x', 'u2')]), echoed()], [START]];
    for (const step of [...steps, [transcript([...done, user('x', 'u2'), assistant([bash('n', 'ls')], 'a2')])]]) {
      await session.apply(...step);
      expect([states()[0], opened()[0]]).toEqual(['stopped', false]);
    }
    expect(states()).toEqual(['stopped', 'going']);
  });

  it('does not wake a turn that had ended when a send into it fails, or is sent again', async () => {
    const session = Session.open([...between]);
    await session.apply(...send(), sendFailed());
    expect(states()).toEqual(['neutral']);
    await session.apply({ type: 'local.message.retrying', clientId: 'p' }, { type: 'run.started', optimistic: true });
    expect(states()).toEqual(['neutral']);
  });
});

/** What a killed session left behind. */
const shellCut = bash('cut', 'sleep 60', running);

it('lets a turn go when its end and the prompt that starts the next one come without an idle between', async () => {
  const at = (state: 'running' | 'completed') => [
    user('Go', 'u1'),
    assistant([shellCut], 'a1', { presentation: { provider: 'codex', turnId: 't1', state } }),
  ];
  const session = Session.open([]);
  await session.apply(START, transcript(at('running')));
  await session.says(...at('completed'), user('also the tests', 'u2'));
  expect([states(), opened()]).toEqual([['stopped'], [false]]);
});

it('tells the queued prompt’s run from the one before, though the thread never showed idle', async () => {
  const first = [user('Go', 'u1'), assistant([bash('b', 'ls')], 'a1')];
  const session = Session.open([]);
  await session.apply(START, transcript(first), { type: 'run.ended', stopReason: 'end_turn' }, START);
  expect(states()).toEqual(['finished']);
  await session.says(...first, user('Then', 'u2'), assistant([bash('c', 'ls')], 'a2'));
  expect(states()).toEqual(['finished', 'going']);
});

it('keeps a turn running under a second message sent before its first words', async () => {
  const session = Session.open([]);
  await session.apply(...send('first'), transcript([user('Go', 'u1')]), echoed('first'), ...send());
  await session.says(user('Go', 'u1'), assistant([bash('b', 'ls')], 'a1'));
  expect([names(), opened()]).toEqual([['Running'], [true]]);
});

it('runs on over a send that failed while it was idle', async () => {
  const done = [user('Go', 'u1'), assistant([bash('b', 'ls'), text('Done')], 'a1')];
  const session = Session.open(done);
  await session.apply(...send(), sendFailed(), START);
  // A background agent came back and the turn goes on, with no message from the viewer.
  await session.says(...done, assistant([bash('c', 'ls', running)], 'a2'));
  expect([names(), opened()]).toEqual([['Running'], [true]]);
});

describe('the stand-in for the coming reply', () => {
  it('is no turn and no message: nothing to copy, no time, no footer', () => {
    Session.reload([user('Go', 'u1')]);
    expect(screen.getByTestId('chat-reply-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId(/^chat-work-header-/)).toBeNull();
    expect(screen.queryByTestId('chat-assistant-message')).toBeNull();
    expect(screen.getAllByTestId('chat-message-footer')).toHaveLength(1);
  });

  it('claims no gap in the conversation, and does not take the status row from the message sent', async () => {
    const asked = { ...user('Go', 'u1'), createdAt: new Date(Date.now() - 3 * 60 * 60_000) } as ThreadMessage;
    const session = Session.reload([asked]);
    expect(screen.getAllByTestId('chat-time-marker')).toHaveLength(1);
    const status = screen.getByTestId('chat-turn-status');
    // The row is not mounted again, which would restart its clock and its fade.
    await session.apply({ type: 'context.usage', percentage: 1, totalTokens: 1, maxTokens: 2 });
    await session.says(asked);
    expect(screen.getByTestId('chat-turn-status')).toBe(status);
  });

  it('leaves the status row above a queued prompt', () => {
    Session.open([user('Go', 'u1')], START, queued());
    const order = screen.getByTestId('chat-turn-status').compareDocumentPosition(screen.getByText('also the tests'));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
