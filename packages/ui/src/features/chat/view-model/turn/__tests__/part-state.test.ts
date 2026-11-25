import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import type { TranscriptPresentation } from '@qlan-ro/mainframe-types';
import { buildTurns, partState } from '../build-turns';
import { TurnCache } from '../turn-cache';
import type { PartState, TurnScope } from '../types';
import { assistant, bash, presented, scope, sources, system, text, thought, user } from './fixtures';

/** Every combination. A column is what the part's own messages say of its end: nothing, finished, stopped, error. */
const TABLE: readonly (readonly [string, readonly PartState[]])[] = [
  ['', ['neutral', 'finished', 'stopped', 'error']],
  ['live', ['going', 'going', 'going', 'going']],
  ['child', ['going', 'going', 'going', 'going']],
  ['live child', ['going', 'going', 'going', 'going']],
  ['waits', ['needs-you', 'needs-you', 'needs-you', 'needs-you']],
  ['waits live', ['needs-you', 'needs-you', 'needs-you', 'needs-you']],
  ['waits child', ['needs-you', 'needs-you', 'needs-you', 'needs-you']],
  ['waits live child', ['needs-you', 'needs-you', 'needs-you', 'needs-you']],
];
const ENDS = [undefined, 'finished', 'stopped', 'error'] as const;

it.each(TABLE)('the rule: %s', (rest, expected) => {
  const is = (word: string) => rest.split(' ').includes(word);
  const states = ENDS.map((ended) =>
    partState({ needsYou: is('waits'), live: is('live'), ...(ended && { ended }) }, is('child')),
  );
  expect(states).toEqual(expected);
});

type Said = TranscriptPresentation['state'];
const open = { result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } };
const states = (messages: ThreadMessage[], options: Partial<TurnScope> = {}) =>
  [...buildTurns(messages, scope(options)).turns.values()].map((turn) => partState(turn, false));
const said = (state: Said, turnId = 'turn') => ({ partSources: sources(1, presented({ state, turnId })) });
const one = [user('u1'), assistant('a1', [bash('ls')])];
const steered = [...one, user('u2'), assistant('a2', [bash('pwd')])];
const runs = { isRunning: true };
const boom = assistant('e1', [text('Boom')], { errorText: 'Boom' });

describe('a part is going while the session runs', () => {
  it('when it is the last one, whatever its provider says of it', () => {
    for (const state of ['running', 'completed', 'cancelled', 'failed', 'invalid'] as const)
      expect(states([user('u1'), assistant('a1', [bash('ls')], said(state))], runs)).toEqual(['going']);
    expect(states([...one, boom], runs)).toEqual(['going']);
    expect(states(steered, runs)).toEqual(['neutral', 'going']);
  });

  it('when it lies after the start of the run, where that was seen', () => {
    expect(states(steered, { ...runs, runAfter: null })).toEqual(['going', 'going']);
    expect(states(steered, { ...runs, runAfter: 'u1' })).toEqual(['going', 'going']);
    expect(states(steered, { ...runs, runAfter: 'a1' })).toEqual(['neutral', 'going']);
    expect(states(steered, { ...runs, runAfter: 'not-loaded' })).toEqual(['neutral', 'going']);
  });

  const asked = { ...open, approval: { id: 'x' } } as never;
  const monitor = (over: object) => ({ ...bash('x', over), toolName: 'Monitor' }) as never;
  it.each([
    // An approval nobody asks for now, before and after the provider placed it.
    ['awaits an approval', bash('ls', asked), undefined, 'neutral'],
    ['awaits an approval', bash('ls', asked), 'running', 'going'],
    ['awaits an approval', bash('ls', asked), 'completed', 'finished'],
    // A monitor is no step: it holds nothing open, whatever its turn says.
    ['is a monitor', monitor(open), undefined, 'neutral'],
    ['is a monitor', monitor(open), 'running', 'neutral'],
    ['is a monitor', monitor(open), 'completed', 'finished'],
    ['came back', bash('ls'), undefined, 'neutral'],
    ['came back', bash('ls'), 'running', 'neutral'],
    ['came back', bash('ls'), 'completed', 'finished'],
  ] as const)('and an earlier one by a step that %s: %j placed as %s', (_name, step, state, expected) => {
    const first = assistant('a1', [step, text('Hm')], state && { partSources: sources(2, presented({ state })) });
    expect(states([user('u1'), first, user('u2'), assistant('a2', [text('Hi')])], runs)).toEqual([expected, 'going']);
  });

  it('does not attribute an earlier open step to a later run', () => {
    const cut = (over?: object) => [
      user('u1'),
      assistant('a1', [bash('ls', open)], over),
      user('u2'),
      assistant('a2', [text('Hi')]),
    ];
    expect(states(cut(), runs)).toEqual(['neutral', 'going']);
    expect(states(cut(), { ...runs, runAfter: 'u2' })).toEqual(['neutral', 'going']);
    expect(states(cut(said('running')), { ...runs, runAfter: 'u2' })).toEqual(['going', 'going']);
    expect(states(cut(said('invalid')), runs)).toEqual(['neutral', 'going']);
    expect(states(cut(said('completed')), runs)).toEqual(['finished', 'going']);
    expect(states(cut(said('cancelled')), runs)).toEqual(['stopped', 'going']);
    expect(states(cut(said('failed')), runs)).toEqual(['error', 'going']);
  });

  it.each([
    ['a queued prompt', user('q', 'x', { queued: true })],
    ['a send that failed', user('f', 'x', { pending: true, error: 'offline' })],
    ['a compaction', system('s', { isCompacted: true })],
  ])('and stays the last one above %s', (_name, message) => {
    expect(states([...one, message], runs)).toEqual(['going']);
  });

  it('and not when the run began after it, with a prompt on its way: an ended turn does not wake', () => {
    const done = [user('u1'), assistant('a1', [bash('ls')], said('completed')), user('p', 'x', { pending: true })];
    expect(states(done, { ...runs, runAfter: 'a1' })).toEqual(['finished']);
    // The run in progress is this one's: what is sent into it ends nothing.
    expect(states(done, { ...runs, runAfter: 'u1' })).toEqual(['going']);
    expect(states(done, runs)).toEqual(['going']);
    // With nothing on its way the agent went on by itself.
    const failed = user('f', 'x', { pending: true, error: 'offline' });
    for (const after of [[], [failed]])
      expect(states([...done.slice(0, 2), ...after], { ...runs, runAfter: 'a1' })).toEqual(['going']);
  });

  it('and only then: nothing in an idle session is going by itself', () => {
    expect(states(steered, { runAfter: null })).toEqual(['neutral', 'neutral']);
    expect(states([user('u1'), assistant('a1', [bash('ls', open)])], {})).toEqual(['neutral']);
  });
});

describe('how a part ended is what its own messages say', () => {
  it.each(['completed', 'cancelled', 'failed'] as const)(
    'keeps a part neutral with an unplaced open step before a %s provider turn',
    (state) => {
      expect(
        states([user('u1'), assistant('a1', [bash('ls', open)]), assistant('a2', [text('Done')], said(state))]),
      ).toEqual(['neutral']);
    },
  );

  it.each([
    ['completed', 'finished'],
    ['cancelled', 'stopped'],
    ['failed', 'error'],
    ['invalid', 'neutral'],
    ['running', 'neutral'],
    ['unknown', 'neutral'],
  ] as const)('a turn its provider calls %s is %s', (state, expected) => {
    expect(states([user('u1'), assistant('a1', [bash('ls')], said(state))])).toEqual([expected]);
  });

  it('is nothing without a provider’s word: no step, no answer and no later part says it', () => {
    expect(states(one)).toEqual(['neutral']);
    expect(states([user('u1'), assistant('a1', [bash('ls'), text('Done.')])])).toEqual(['neutral']);
    const last = assistant('a2', [bash('pwd')], said('completed'));
    expect(states([...one, user('u2'), last])).toEqual(['neutral', 'finished']);
  });

  it('is nothing when the provider has not placed the last words', () => {
    const done = assistant('a1', [bash('ls')], said('completed'));
    expect(states([user('u1'), done, assistant('a2', [text('It came back')])])).toEqual(['neutral']);
    expect(states([user('u1'), done, assistant('a2', [text(' ')])])).toEqual(['finished']);
    // Parts of the last message itself need not all be placed.
    expect(states([user('u1'), assistant('a1', [bash('ls'), thought()], said('completed'))])).toEqual(['finished']);
  });

  it.each([
    ['cancelled', 'stopped'],
    ['error', 'error'],
    ['other', 'neutral'],
  ] as const)('a last message that is incomplete for %s is %s', (reason, expected) => {
    const status = { status: { type: 'incomplete', reason } };
    const half = assistant('a1', [text('Half')], undefined, status);
    expect(states([user('u1'), half])).toEqual([expected]);
    expect(states([user('u1'), half, assistant('a2', [text('More')])])).toEqual(['neutral']);
  });

  it('is an error when nothing in the part follows the error message', () => {
    expect(states([...one, boom])).toEqual(['error']);
    expect(states([...one, boom, assistant('a2', [text(' ')])])).toEqual(['error']);
    expect(states([...one, boom, assistant('a2', [text('Done')])])).toEqual(['neutral']);
    expect(states([user('u1'), assistant('a1', [bash('ls')], said('completed')), boom])).toEqual(['error']);
    expect(states([user('u1'), assistant('a1', [bash('ls')], said('cancelled')), boom])).toEqual(['stopped']);
    // Not one of another part.
    expect(states([...one, user('u2'), boom])).toEqual(['neutral']);
    expect(states([...one, boom, ...steered.slice(2)])).toEqual(['error', 'neutral']);
  });

  const turn = (state: Said, turnId: string) => presented({ state, turnId });
  const two = (first: TranscriptPresentation, second: TranscriptPresentation, over = {}) => [
    user('u1'),
    assistant('a1', [bash('ls', over), text('Done')], {
      partSources: { 0: sources(1, first)[0], 1: sources(1, second)[0] },
    }),
  ];
  it.each([
    ['completed', 'finished'],
    ['running', 'finished'],
    ['unknown', 'finished'],
    ['cancelled', 'neutral'],
    ['invalid', 'neutral'],
    ['failed', 'neutral'],
  ] as const)('a completed turn after one that is %s in the same part is %s', (state, expected) => {
    expect(states(two(turn(state, 't1'), turn('completed', 't2')))).toEqual([expected]);
  });
  it('is the last turn’s, where several lie in one part', () => {
    expect(states(two(turn('completed', 't1'), turn('cancelled', 't2')))).toEqual(['stopped']);
    expect(states(two(turn('invalid', 't1'), turn('failed', 't2')))).toEqual(['error']);
    expect(states(two(turn('completed', 't1'), turn('invalid', 't2')))).toEqual(['neutral']);
    // A turn cut in a step, with another after it.
    expect(states(two(turn('running', 't1'), turn('completed', 't2'), open))).toEqual(['neutral']);
    expect(states(two(turn('completed', 't1'), turn('completed', 't2'), open))).toEqual(['finished']);
    const three = [bash('ls', open), bash('pwd'), text('Done')];
    const of = [turn('running', 't1'), turn('running', 't1'), turn('completed', 't2')];
    const partSources = Object.fromEntries(of.map((each, index) => [index, sources(1, each)[0]]));
    expect(states([user('u1'), assistant('a1', three, { partSources })])).toEqual(['neutral']);
    // One turn whose last part has the newest word is one turn.
    expect(states(two(turn('invalid', 't1'), turn('completed', 't1')))).toEqual(['finished']);
  });
});

it('is the only part that waits when an earlier one’s background agent asks nothing', () => {
  const nested = [assistant('n', [bash('rm', { toolCallId: 'ask', ...open })])];
  const agent = { ...bash('x'), toolName: 'Task', toolCallId: 'agent', messages: nested } as never;
  const asked = (messages: ThreadMessage[]) => states(messages, { pendingToolIds: new Set(['ask']) });
  expect(asked([user('u1'), assistant('a1', [agent])])).toEqual(['needs-you']);
  expect(asked([user('u1'), assistant('a1', [agent]), user('u2'), assistant('a2', [text('B')])])).toEqual([
    'neutral',
    'neutral',
  ]);
});

describe('a step that awaits approval and the end of its part', () => {
  const asked = (over: object = {}) => bash('ls', { ...open, approval: { id: 'x' }, ...over } as never);
  const part = (step: ReturnType<typeof bash>, over?: object) => [user('u1'), assistant('a1', [step], over)];
  const pending = { pendingToolIds: new Set(['ask']) };

  it('lets no part end that the provider has not placed it in', () => {
    const boomed = [...part(asked()), boom];
    expect(states(boomed)).toEqual(['neutral']);
    const settled = asked({ result: 'ok', providerMetadata: { mainframe: { acpStatus: 'completed' } } });
    expect(states([...part(settled), boom])).toEqual(['neutral']);
    const answered = asked({ result: 'no', approval: { id: 'x', approved: false } });
    expect(states([...part(answered), boom])).toEqual(['error']);
  });

  it('cuts an earlier provider turn short in a part a later one completed', () => {
    const two = [asked(), text('Done')];
    const of = [presented({ state: 'running', turnId: 't1' }), presented({ state: 'completed', turnId: 't2' })];
    const partSources = { 0: sources(1, of[0]!)[0], 1: sources(1, of[1]!)[0] };
    expect(states([user('u1'), assistant('a1', two, { partSources })])).toEqual(['neutral']);
  });

  it('waits on the viewer when the request is there, also once its turn completed', () => {
    const step = asked({ toolCallId: 'ask', result: 'ok' });
    for (const state of ['running', 'completed'] as const)
      expect(states(part(step, said(state)), pending)).toEqual(['needs-you']);
    // Answered, the same part says what its provider says.
    expect(states(part(asked({ toolCallId: 'ask', result: 'ok', approval: undefined }), said('completed')))).toEqual([
      'finished',
    ]);
  });
});

describe('whether a neutral part may fold by itself', () => {
  it.each([
    ['settled', { result: 'ok' }, false],
    ['lost', { result: undefined }, true],
    // Its row reads stopped.
    ['open', open, false],
  ] as const)('a step that is %s', (_name, over, unclear) => {
    const [turn] = buildTurns([user('u1'), assistant('a1', [bash('ls', over)])], scope()).turns.values();
    expect(turn!.unclear).toBe(unclear);
  });
});

describe('a turn’s object is another one when only its evidence moved', () => {
  const call = (over: object) => [user('u1'), assistant('a1', [bash('ls', { toolCallId: 'b', ...over })])];
  const at = (state: Said) => [user('u1'), assistant('a1', [bash('ls', { toolCallId: 'b' })], said(state))];
  type Build = readonly [ThreadMessage[], Partial<TurnScope>];
  it.each<[string, Build, Build]>([
    ['how it ended', [at('running'), {}], [at('completed'), {}]],
    ['whether it is of the run', [steered, { ...runs, runAfter: 'u1' }], [steered, { ...runs, runAfter: 'a1' }]],
    ['whether the session runs', [steered, { runAfter: null }], [steered, { ...runs, runAfter: null }]],
    ['whether an outcome is unknown', [call({ result: undefined }), {}], [call({ result: 'ok' }), {}]],
  ])('%s', (_what, [before, options], [after, then]) => {
    const cache = new TurnCache();
    const first = (messages: ThreadMessage[], given: Partial<TurnScope>) =>
      [...buildTurns(messages, scope(given), cache).turns.values()][0]!;
    const turn = first(before, options);
    expect(first(before, { ...options })).toBe(turn);
    const next = first(after, then);
    const read = ({ needsYou, live, ended, unclear }: typeof turn) => [needsYou, live, ended, unclear];
    expect(read(next)).not.toEqual(read(turn));
  });
});
