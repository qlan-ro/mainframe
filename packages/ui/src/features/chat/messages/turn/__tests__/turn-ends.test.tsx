/** How a run's parts stand once it is over, or once a reload has forgotten where it began: each by its own messages. */
import { screen, waitFor } from '@testing-library/react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { TranscriptPresentation } from '@qlan-ro/mainframe-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listBackgroundTasks } from '@/lib/api/background-tasks';
import { useUiPrefs } from '@/store/ui-prefs';
import { assistant, bash, failed, running, text, tool, user } from './fixtures';
import {
  IDLE,
  PROVIDERS,
  START,
  Session,
  echoed,
  names,
  opened,
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

beforeEach(() => {
  useUiPrefs.setState({ finishedWork: 'fold' });
  vi.mocked(listBackgroundTasks).mockReset().mockResolvedValue([]);
});

type Content = Extract<ThreadMessage, { role: 'assistant' }>['content'];
type Said = Partial<TranscriptPresentation> | undefined;
const turn = (presentation: Said, ...content: ThreadMessage['content']): ThreadMessage[] => [
  user('Go', 'u1'),
  assistant(content as never, 'a1', { presentation }),
];
const claude = (state: 'running' | 'invalid' | 'completed') => ({ provider: 'claude', turnId: 't1', state }) as const;
const codex = (state: 'running' | 'cancelled' | 'completed') => ({ provider: 'codex', turnId: 't1', state }) as const;
const settled = bash('b', 'ls');
const cut = bash('cut', 'sleep 60', running);
const half = text('I will now ch');

/** What each provider says while the turn runs, once it was cut, and what is stored of that. */
const CUT: [string, Said, Said, Said, string][] = [
  ['claude', claude('running'), claude('invalid'), undefined, 'Worked'],
  ['codex', codex('running'), codex('cancelled'), codex('cancelled'), 'Stopped'],
];

describe.each(CUT)('a turn of %s', (_name, runs, over, stored, word) => {
  const cuts: [string, Content][] = [
    ['in the middle of its words', [settled, half]],
    ['while it thought', [settled]],
    ['in the middle of a step', [settled, cut]],
    ['in a step the interrupt failed', [bash('b', 'sleep 60', failed)]],
  ];
  it.each(cuts)('reads the same when interrupted %s, live and after a reload', async (_at, content) => {
    const session = Session.open([]);
    await session.apply(START, transcript(turn(runs, ...content)));
    expect(names()).toEqual(['Running']);
    await session.apply({ type: 'run.cancelling' });
    expect(names()).toEqual(['Running']);
    await session.apply(transcript(turn(over, ...content)), IDLE);
    expect([names(), opened()]).toEqual([[word], [false]]);
    session.close();
    Session.open(turn(stored, ...content));
    expect(names()).toEqual([word]);
  });

  it.each([
    ['settled', [settled, half]],
    ['open', [settled, cut]],
  ] as [string, Content][])('claims nothing when its process was killed with %s steps', async (_at, content) => {
    const session = Session.open([]);
    await session.apply(START, transcript(turn(runs, ...content)), IDLE);
    expect([names(), opened()]).toEqual([['Worked'], [false]]);
    session.close();
    Session.open(turn(runs, ...content));
    expect(names()).toEqual(['Worked']);
  });
});

it('reads the parts of a run each from its own messages', async () => {
  const session = Session.open([]);
  const done = assistant([bash('c', 'ls'), text('Done')], 'a2', { presentation: claude('completed') });
  await session.apply(START, transcript([...turn(claude('running'), settled), user('More', 'u2')]));
  expect(names()).toEqual(['Still going']);
  await session.apply(transcript([...turn(claude('invalid'), settled), user('More', 'u2'), done]), IDLE);
  expect(names()).toEqual(['Worked', 'Finished']);
});

describe.each(PROVIDERS)('a reload while %s runs', (_name, presentation) => {
  const steered = (...content: ThreadMessage['content']) => [...turn(presentation, ...content), user('More', 'u2')];
  const reply = assistant([bash('c', 'ls')], 'a2', { presentation });

  const stepIsLive = presentation?.state === 'running';
  const openStepLabel = stepIsLive ? 'Still going' : 'Worked';

  it('uses the open step’s provider state when the run start is unknown', () => {
    Session.reload(steered(cut));
    expect([names(), opened()]).toEqual([[openStepLabel], [stepIsLive]]);
  });

  it('claims nothing for a settled part somebody wrote after', async () => {
    const session = Session.reload(steered(settled));
    expect(names()).toEqual(['Worked']);
    await session.says(...steered(settled), reply);
    expect(names()).toEqual(['Worked', 'Running']);
    await session.apply(IDLE);
    expect(names()).toEqual(['Worked', 'Worked']);
  });

  it('keeps the part it writes in going, until somebody writes after it', async () => {
    const session = Session.reload(turn(presentation, settled));
    expect([names(), opened()]).toEqual([['Running'], [true]]);
    await session.apply(...send());
    expect(names()).toEqual(['Running']);
    await session.apply(transcript(steered(settled)), echoed());
    expect(names()).toEqual(['Worked']);
    await session.says(...steered(settled), reply);
    expect(names()).toEqual(['Worked', 'Running']);
  });

  it('shows an open step as neutral at idle and reads provider evidence while running', async () => {
    const session = Session.reload(steered(cut));
    await session.apply(IDLE);
    expect([names(), opened()]).toEqual([['Worked'], [false]]);
    expect(screen.queryByTestId('chat-row-cut')).toBeNull();
    await session.apply(...send());
    expect(names()).toEqual([openStepLabel]);
  });
});

describe('an error', () => {
  const boom = assistant([text('Overloaded')], 'e', { custom: { errorText: 'API Error: overloaded' } });
  const on = assistant([bash('c', 'ls'), text('Done.')], 'a2', { presentation: claude('completed') });

  it('the turn got over is not how it ended', async () => {
    const session = Session.open([]);
    await session.apply(START, transcript([...turn(claude('running'), settled), boom]));
    expect(names()).toEqual(['Running']);
    const messages = [...turn(claude('completed'), settled), boom, on];
    await session.apply(transcript(messages), IDLE);
    expect(names()).toEqual(['Finished']);
    session.close();
    Session.open(messages);
    expect(names()).toEqual(['Finished']);
  });

  it('the turn did not get over is how it ended', async () => {
    const session = Session.open([]);
    await session.apply(START, transcript([...turn(claude('invalid'), settled), boom]), IDLE);
    expect(names()).toEqual(['Ended on an error']);
  });

  it('that came after a steer is no end of the part before it', async () => {
    const session = Session.open([]);
    await session.apply(START, transcript([...turn(undefined, settled), user('More', 'u2'), boom]));
    expect(names()).toEqual(['Still going']);
    await session.apply(IDLE);
    expect(names()).toEqual(['Worked']);
  });
});

describe('a sub-agent that outlives the turn', () => {
  const agent = (over: object) => tool({ toolCallId: 'agent', toolName: 'Task', args: { prompt: 'Look' }, ...over });
  const launched = agent({ result: 'Async agent launched successfully.' });
  const task = { id: 'bg', kind: 'agent', toolUseId: 'agent', status: 'running', startedAt: 1 };
  const live = { id: 'bg', kind: 'agent', description: 'x', startedAt: 1 } as const;

  it('holds it open while the daemon says it runs, and then leaves the turn as it ended', async () => {
    vi.mocked(listBackgroundTasks).mockResolvedValue([task] as never);
    const session = Session.open([]);
    await session.apply(START, transcript(turn(claude('running'), launched, text('Started'))));
    const over = turn(claude('completed'), launched, text('Started'));
    await session.apply({ type: 'background.upsert', task: live }, transcript(over), IDLE);
    await waitFor(() => expect([states(), opened()]).toEqual([['going'], [true]]));
    vi.mocked(listBackgroundTasks).mockResolvedValue([{ ...task, status: 'completed' }] as never);
    await session.apply({ type: 'background.ended', taskId: 'bg' });
    await waitFor(() => expect([states(), opened()]).toEqual([['finished'], [false]]));
  });

  it('goes on for nobody once nothing says it runs', async () => {
    const session = Session.open([]);
    const left = turn(codex('running'), agent(running));
    await session.apply(START, transcript(left));
    expect(states()).toEqual(['going']);
    await session.apply(IDLE);
    expect([states(), opened()]).toEqual([['neutral'], [false]]);
  });
});

it('does not read a failed send as the end of anything', async () => {
  const session = Session.open(turn(claude('completed'), settled, text('Done')));
  await session.apply(...send(), sendFailed());
  expect(names()).toEqual(['Finished']);
});
