import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import type { RunRecord } from '../../../controller/run-records';
import { buildTurns, partState } from '../build-turns';
import type { PartEvidence, PartState, TurnScope } from '../types';
import { assistant, bash, presented, scope, sources, system, text, user } from './fixtures';

/**
 * Every combination that can occur. A column is how the turn ended: nothing
 * said, completed, cancelled, error. A row is the rest of the evidence.
 */
const TABLE: readonly (readonly [PartEvidence['run'], string, readonly PartState[]])[] = [
  ['current', '', ['going', 'going', 'going', 'going']],
  ['current', 'unsettled', ['going', 'going', 'going', 'going']],
  ['current', 'child', ['going', 'going', 'going', 'going']],
  ['current', 'unsettled child', ['going', 'going', 'going', 'going']],
  ['unknown', '', ['neutral', 'finished', 'stopped', 'error']],
  ['unknown', 'unsettled', ['going', 'going', 'going', 'going']],
  ['unknown', 'child', ['going', 'going', 'going', 'going']],
  ['unknown', 'unsettled child', ['going', 'going', 'going', 'going']],
  ['over', '', ['neutral', 'finished', 'stopped', 'error']],
  ['over', 'unsettled', ['stopped', 'stopped', 'stopped', 'error']],
  ['over', 'child', ['going', 'going', 'going', 'going']],
  ['over', 'unsettled child', ['going', 'going', 'going', 'going']],
];
const ENDS = [undefined, 'completed', 'cancelled', 'error'] as const;

describe('the rule', () => {
  it.each(TABLE)('%s run, %s', (run, rest, expected) => {
    const unsettled = rest.includes('unsettled');
    const child = rest.includes('child');
    const state = (needsYou: boolean) =>
      ENDS.map((ended) => partState({ needsYou, run, unsettled, ...(ended && { ended }) }, child));
    expect(state(false)).toEqual(expected);
    // A request outranks everything else.
    expect(state(true)).toEqual(['needs-you', 'needs-you', 'needs-you', 'needs-you']);
  });
});

const open = { result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } };
const mark = (id: string, parts = 1) => ({ id, parts });
const states = (messages: ThreadMessage[], options: Partial<TurnScope> = {}) =>
  [...buildTurns(messages, scope(options)).turns.values()].map((turn) => partState(turn.evidence, false));
const said = (state: 'completed' | 'cancelled' | 'failed' | 'invalid' | 'running') => ({
  partSources: sources(1, presented({ state })),
});
const one = [user('u1'), assistant('a1', [bash('ls')])];
const steered = [...one, user('u2'), assistant('a2', [bash('pwd')])];
const ran = (over: Partial<RunRecord> = {}): RunRecord => ({ after: null, exact: true, ...over });
const ended = (id: string, reason?: NonNullable<RunRecord['end']>['reason'], parts = 1) => ({
  end: { until: mark(id, parts), ...(reason && { reason }) },
});

describe('which evidence a part has', () => {
  it.each([
    ['completed', 'finished'],
    ['cancelled', 'stopped'],
    ['failed', 'error'],
    ['invalid', 'neutral'],
    ['running', 'neutral'],
  ] as const)('reads a turn the provider calls %s as %s, once idle', (state, expected) => {
    expect(states([user('u1'), assistant('a1', [bash('ls')], said(state))])).toEqual([expected]);
  });

  it.each([
    ['end_turn', 'finished'],
    ['cancelled', 'stopped'],
    ['_mainframe.dev/error', 'error'],
    ['max_tokens', 'neutral'],
    ['refusal', 'neutral'],
    [undefined, 'neutral'],
  ] as const)('reads every part of a run the daemon ended with %s as %s', (reason, expected) => {
    expect(states(steered, { runs: [ran(ended('a2', reason))] })).toEqual([expected, expected]);
  });

  it('lets an interrupted provider be, and takes the daemon’s word for how the run ended', () => {
    const invalid = [user('u1'), assistant('a1', [bash('ls')], said('invalid'))];
    expect(states(invalid, { runs: [ran(ended('a1', 'cancelled'))] })).toEqual(['stopped']);
  });

  it('gives no run’s end to a part another run wrote', () => {
    const runs = [ran(ended('a1', 'cancelled'))];
    expect(states(steered, { runs })).toEqual(['stopped', 'neutral']);
    expect(states(steered, { runs: [ran({ after: mark('a1') }), ...runs].reverse() })).toEqual(['stopped', 'neutral']);
    expect(states(steered, { runs: [ran({ after: mark('a1'), ...ended('a2', 'end_turn') })] })).toEqual([
      'neutral',
      'finished',
    ]);
  });

  it('gives no run’s end to parts a message gained after it', () => {
    const grown = [user('u1'), assistant('a1', [bash('ls'), text('And on')])];
    expect(states(grown, { runs: [ran(ended('a1', 'end_turn'))] })).toEqual(['neutral']);
    expect(states(grown, { runs: [ran(ended('a1', 'end_turn', 2))] })).toEqual(['finished']);
  });

  it('knows a part that gained parts in the run in progress', () => {
    const grown = [user('u1'), assistant('a1', [bash('ls'), text('And on')])];
    const runs = [ran(ended('a1', 'end_turn')), ran({ after: mark('a1') })];
    expect(states(one, { isRunning: true, runs })).toEqual(['finished']);
    expect(states(grown, { isRunning: true, runs })).toEqual(['going']);
  });

  it('is told nothing by a run whose place is not loaded', () => {
    expect(states(one, { runs: [ran({ after: mark('gone'), ...ended('a1', 'end_turn') })] })).toEqual(['neutral']);
    expect(states(one, { runs: [ran(ended('gone', 'end_turn'))] })).toEqual(['neutral']);
  });

  it('counts a step with no outcome as stopped only once nothing can finish it', () => {
    const cut = [user('u1'), assistant('a1', [bash('ls', open)])];
    expect(states(cut)).toEqual(['stopped']);
    expect(states(cut, { isRunning: true })).toEqual(['going']);
    const later = [...cut, user('u2'), assistant('a2', [bash('pwd')])];
    // Where the run began isn't known: it may still be this one's.
    expect(states(later, { isRunning: true })).toEqual(['going', 'going']);
    // It is known to have begun after it, or the thread was seen idle since.
    expect(states(later, { isRunning: true, runs: [ran({ after: mark('a1') })] })).toEqual(['stopped', 'going']);
    const idle = ran(ended('a1'));
    const again = ran({ after: mark('u2'), exact: false });
    expect(states(later, { isRunning: true, runs: [idle, again] })).toEqual(['stopped', 'going']);
  });

  it('claims nothing for a settled part of a run whose beginning is not known', () => {
    expect(states(steered, { isRunning: true })).toEqual(['neutral', 'going']);
    const runs = [ran({ after: mark('u2'), exact: false })];
    expect(states(steered, { isRunning: true, runs })).toEqual(['neutral', 'going']);
    expect(states(steered, { isRunning: true, runs: [ran()] })).toEqual(['going', 'going']);
  });

  it('lets a turn its provider ended go, though the next run has begun', () => {
    const done = [user('u1'), assistant('a1', [bash('ls')], said('completed'))];
    expect(states(done, { isRunning: true })).toEqual(['finished']);
    expect(states([user('u1'), assistant('a1', [bash('ls', open)], said('completed'))], { isRunning: true })).toEqual([
      'stopped',
    ]);
    // Parts the provider has said nothing of are not the turn it ended.
    const on = [...done, assistant('a2', [text('It came back')])];
    expect(states(on, { isRunning: true })).toEqual(['going']);
  });

  it('is an error only when nothing said after it', () => {
    const boom = assistant('e1', [text('Boom')], { errorText: 'Boom' });
    expect(states([...one, boom])).toEqual(['error']);
    expect(states([...one, boom, assistant('a2', [text('Done')])])).toEqual(['neutral']);
    expect(states([...one, boom, assistant('a2', [text(' ')])])).toEqual(['error']);
    const on = [...one, boom, user('u2'), assistant('a2', [bash('pwd')])];
    expect(states(on)).toEqual(['error', 'neutral']);
    expect(states(on, { runs: [ran(ended('a2', 'end_turn'))] })).toEqual(['finished', 'finished']);
    expect(states(on, { isRunning: true, runs: [ran()] })).toEqual(['going', 'going']);
  });

  it('is an error of the whole run, wherever in it the error came', () => {
    const boom = assistant('e1', [text('Boom')], { errorText: 'Boom' });
    expect(states([...one, user('u2'), boom], { runs: [ran(ended('e1', 'end_turn'))] })).toEqual(['error']);
    // Just after its end; the next run's error is not this one's.
    expect(states([...one, boom], { runs: [ran(ended('a1', 'end_turn'))] })).toEqual(['error']);
    const next = [...one, user('u2'), boom];
    const runs = [ran(ended('a1', 'end_turn')), ran({ after: mark('a1'), ...ended('e1') })];
    expect(states(next, { runs })).toEqual(['finished']);
  });

  it('is not the run before’s, when its own run said nothing', () => {
    const boom = assistant('e1', [text('Boom')], { errorText: 'Boom' });
    const blank = [...one, boom, user('u2'), assistant('a2', [text(' ')])];
    const runs = [ran(ended('e1', 'end_turn')), ran({ after: mark('e1'), ...ended('a2', 'end_turn', 0) })];
    expect(states(blank, { runs })).toEqual(['error', 'finished']);
  });

  it('is stopped, not an error, when the viewer stopped what an error had interrupted', () => {
    const boom = assistant('e1', [text('Boom')], { errorText: 'Boom' });
    expect(states([...one, boom], { runs: [ran(ended('e1', 'cancelled'))] })).toEqual(['stopped']);
  });

  it.each([
    ['cancelled', 'stopped'],
    ['error', 'error'],
    ['other', 'neutral'],
  ] as const)('reads a last message that is incomplete for %s as %s', (reason, expected) => {
    const status = { status: { type: 'incomplete', reason } };
    expect(states([user('u1'), assistant('a1', [text('Half')], undefined, status)])).toEqual([expected]);
  });

  it.each([
    ['a queued prompt', user('q', 'x', { queued: true })],
    ['an unconfirmed send', user('p', 'x', { pending: true })],
    ['a send that failed', user('f', 'x', { pending: true, error: 'offline' })],
    ['a compaction', system('s', { isCompacted: true })],
  ])('is not ended by %s', (_name, message) => {
    expect(states([...one, message], { isRunning: true })).toEqual(['going']);
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
});
