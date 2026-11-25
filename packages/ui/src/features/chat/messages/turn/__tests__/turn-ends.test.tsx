/** How a run's parts stand once it is over, or once a reload has forgotten where it began. */
import { screen, waitFor } from '@testing-library/react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { TranscriptPresentation } from '@qlan-ro/mainframe-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listBackgroundTasks } from '@/lib/api/background-tasks';
import { useUiPrefs } from '@/store/ui-prefs';
import { assistant, bash, failed, running, text, tool, user } from './fixtures';
import { PROVIDERS, START, Session, idle, names, opened, send, sendFailed, states, transcript } from './run-fixture';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn().mockResolvedValue([]),
  readBackgroundTaskOutput: vi.fn().mockResolvedValue({ text: '', truncated: false }),
}));

beforeEach(() => {
  useUiPrefs.setState({ finishedWork: 'fold' });
  vi.mocked(listBackgroundTasks).mockReset().mockResolvedValue([]);
});

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
const CUT: [string, Said, Said, Said][] = [
  ['claude', claude('running'), claude('invalid'), undefined],
  ['codex', codex('running'), codex('cancelled'), codex('cancelled')],
];

describe.each(CUT)('a turn of %s', (name, runs, over, stored) => {
  it.each([
    ['in the middle of its words', [settled, half]],
    ['while it thought', [settled]],
    ['in the middle of a step', [settled, cut]],
    ['in a step the interrupt failed', [bash('b', 'sleep 60', failed)]],
  ])('reads stopped when interrupted %s, and never finished after a reload', async (_at, content) => {
    const session = Session.open([]);
    await session.apply(START, transcript(turn(runs, ...content)));
    expect(names()).toEqual(['Running']);
    await session.apply({ type: 'run.cancelling' });
    expect(names()).toEqual(['Running']);
    await session.apply(transcript(turn(over, ...content)), ...idle('cancelled'));
    expect([names(), opened()]).toEqual([['Stopped'], [false]]);
    session.close();

    Session.open(turn(stored, ...content));
    const unsettled = content.includes(cut);
    expect(states()).toEqual([name === 'codex' || unsettled ? 'stopped' : 'neutral']);
  });

  it('reads as the daemon says when its process was killed, and never finished after a reload', async () => {
    const left = turn(runs, settled, half);
    const session = Session.open([]);
    await session.apply(START, transcript(left), ...idle('_mainframe.dev/error'));
    expect(names()).toEqual(['Ended on an error']);
    session.close();
    Session.open(left);
    expect(names()).toEqual(['Worked']);
  });

  it('reads stopped when nothing says how a run with an open step ended', async () => {
    const session = Session.open([]);
    await session.apply(START, transcript(turn(runs, settled, cut)), { type: 'run.stopped' });
    expect([names(), opened()]).toEqual([['Stopped'], [false]]);
    expect(screen.queryByTestId('chat-row-cut')).toBeNull();
  });

  it('claims nothing when nothing says how a run with settled steps ended', async () => {
    const session = Session.open([]);
    await session.apply(START, transcript(turn(claude('invalid'), settled, text('Done'))), { type: 'run.stopped' });
    expect([names(), opened()]).toEqual([['Worked'], [false]]);
  });
});

describe.each(PROVIDERS)('a reload while %s runs', (_name, presentation) => {
  const steered = (...content: ThreadMessage['content']) => [...turn(presentation, ...content), user('More', 'u2')];
  const reply = assistant([bash('c', 'ls')], 'a2', { presentation });

  it('keeps an open step going, whatever was written after it', () => {
    Session.reload(steered(cut));
    expect([names(), opened()]).toEqual([['Still going'], [true]]);
  });

  it('claims nothing for a settled part somebody wrote after', async () => {
    const session = Session.reload(steered(settled));
    expect(names()).toEqual(['Worked']);
    await session.says(...steered(settled), reply);
    expect(names()).toEqual(['Worked', 'Running']);
    await session.apply(...idle('cancelled'));
    // Where the run began isn't known, so its end is only the last part's.
    expect(names()).toEqual(['Worked', 'Stopped']);
  });

  it('keeps the part it writes in going, and the messages sent from then on end nothing', async () => {
    const session = Session.reload(turn(presentation, settled));
    expect([names(), opened()]).toEqual([['Running'], [true]]);
    await session.apply(...send());
    expect(names()).toEqual(['Running']);
    await session.says(...steered(settled));
    expect(names()).toEqual(['Still going']);
    await session.says(...steered(settled), reply);
    expect(names()).toEqual(['Still going', 'Running']);
  });

  it('stops an open step once the session went idle, and the next run does not wake it', async () => {
    const session = Session.reload(steered(cut));
    await session.apply(...idle());
    expect([names(), opened()]).toEqual([['Stopped'], [false]]);
    await session.apply(...send());
    expect([names(), opened()]).toEqual([['Stopped'], [false]]);
  });
});

it('reads a run that ended while the client was away by its steps alone', async () => {
  const session = Session.open([]);
  await session.apply(START, transcript(turn(claude('running'), settled)));
  // The replay's idle gives no reason.
  await session.apply(transcript(turn(claude('invalid'), settled, text('Done'))), ...idle());
  expect(names()).toEqual(['Worked']);
});

describe('an error', () => {
  const boom = assistant([text('Overloaded')], 'e', { custom: { errorText: 'API Error: overloaded' } });
  const on = assistant([bash('c', 'ls'), text('Done.')], 'a2', { presentation: claude('completed') });

  it('the turn got over is not how it ended', async () => {
    const session = Session.open([]);
    await session.apply(START, transcript([...turn(claude('running'), settled), boom]));
    expect(names()).toEqual(['Running']);
    const messages = [...turn(claude('completed'), settled), boom, on];
    await session.apply(transcript(messages), ...idle('end_turn'));
    expect(names()).toEqual(['Finished']);
    session.close();
    Session.open(messages);
    expect(names()).toEqual(['Finished']);
  });

  it('the turn did not get over is how it ended, though the run was completed', async () => {
    const session = Session.open([]);
    await session.apply(START, transcript([...turn(claude('invalid'), settled), boom]), ...idle('end_turn'));
    expect(names()).toEqual(['Ended on an error']);
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
    await session.apply({ type: 'background.upsert', task: live }, ...idle('end_turn'));
    await waitFor(() => expect([states(), opened()]).toEqual([['going'], [true]]));
    await session.apply({ type: 'background.ended', taskId: 'bg' });
    await waitFor(() => expect([states(), opened()]).toEqual([['finished'], [false]]));
  });

  it('goes on for nobody once nothing says it runs: a call with no outcome was cut', async () => {
    const session = Session.open([]);
    const left = turn(codex('running'), agent(running));
    await session.apply(START, transcript(left));
    expect(states()).toEqual(['going']);
    await session.apply(...idle('end_turn'));
    expect(states()).toEqual(['stopped']);
  });
});

it('does not read a failed send as the end of anything', async () => {
  const session = Session.open(turn(claude('completed'), settled, text('Done')));
  await session.apply(...send(), sendFailed());
  expect(names()).toEqual(['Finished']);
});

it.each([
  ['end_turn', 'finished'],
  ['cancelled', 'stopped'],
  ['_mainframe.dev/error', 'error'],
] as const)('preserves %s across window changes and a late subscription', async (reason, expected) => {
  const previous = [user('Earlier', 'u0'), assistant([settled], 'a0')];
  const prompt = user('Go', 'u1');
  const reply = assistant([settled], 'a1');
  const blank = assistant([text(' ')], 'blank');
  for (const sawStart of [true, false]) {
    const session = Session.open([...previous, prompt], ...(sawStart ? [START] : []));
    await session.apply(transcript([...previous, prompt, reply]), ...idle(reason));
    expect(states()).toEqual(['neutral', expected]);
    for (const window of [[reply], [prompt, reply, blank], [...previous, prompt, reply, blank]]) {
      await session.says(...window);
      session.remount();
      await waitFor(() => expect(states()).toEqual(window.includes(previous[0]!) ? ['neutral', expected] : [expected]));
    }
    session.close();
  }
  Session.open([prompt, reply, blank]);
  expect(states()).toEqual(['neutral']);
});
