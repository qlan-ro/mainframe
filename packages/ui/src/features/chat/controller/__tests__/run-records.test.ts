/** Where a run began and ended, from the events the controller reduces. */
import { describe, expect, it } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { ChatStateEvent, ChatThreadState } from '../chat-thread-state';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';
import { visibleParts } from '../run-records';

const user = (id: string): ThreadMessageLike => ({ id, role: 'user', content: 'hi' });
const reply = (id: string, ...texts: string[]): ThreadMessageLike => ({
  id,
  role: 'assistant',
  content: texts.map((text) => ({ type: 'text' as const, text })),
});
const transcript = (...messages: ThreadMessageLike[]): ChatStateEvent => ({ type: 'transcript.updated', messages });
const ready: ChatThreadState = { ...createChatThreadState('c'), loadState: { type: 'ready' } };
const reduce = (events: ChatStateEvent[], from = ready) => events.reduce(reduceChatThreadState, from);
const runs = (events: ChatStateEvent[], from = ready) => reduce(events, from).runs;

const START = { type: 'run.started' } as const;
const SEND = { type: 'run.started', optimistic: true } as const;
const STOPPED = { type: 'run.stopped' } as const;
const ended = (stopReason?: 'end_turn' | 'cancelled'): ChatStateEvent => ({ type: 'run.ended', stopReason });
const fail = { type: 'local.message.failed', clientId: 'p', error: 'x', stage: 'send' } as const;
const pending = { clientId: 'p', chatId: 'c', text: 'x', createdAt: 1, status: 'pending' } as const;
const at = (id: string, parts = 1) => ({ id, parts });

describe('where a run begins', () => {
  it('is the idle → running edge', () => {
    expect(runs([START])).toEqual([{ after: null, exact: true }]);
    expect(runs([transcript(user('u1'), reply('a1', 'One', 'Two')), START])).toEqual([
      { after: at('a1', 2), exact: true },
    ]);
  });

  it('never moves while the run goes: steers, sends, frames, cancelling', () => {
    const begun = [transcript(user('u1')), SEND, transcript(user('u1'), reply('a1', 'One'))];
    const more: ChatStateEvent[] = [
      START,
      { type: 'run.started', startedAtMs: 5 },
      SEND,
      transcript(user('u1'), reply('a1', 'One'), user('u2')),
      { type: 'run.started', startedAtMs: 5 },
      { type: 'run.started', startedAtMs: 5, replayed: true },
      { type: 'run.cancelling' },
      START,
    ];
    expect(runs([...begun, ...more])).toEqual([{ after: at('u1'), exact: true, startedAtMs: 5, optimistic: false }]);
  });

  it('keeps the same list when a frame says nothing new', () => {
    const state = reduce([START, { type: 'run.started', startedAtMs: 5 }]);
    expect(runs([{ type: 'run.started', startedAtMs: 5 }, START], state)).toBe(state.runs);
  });

  it.each([
    ['a replay', ready, { ...START, replayed: true }],
    ['a transcript that has not loaded', createChatThreadState('c'), SEND],
    ['an error nobody explained', { ...ready, runState: { type: 'error', error: 'x' } as const }, START],
  ] as const)('is not known from %s: it counts from the last message sent', (_name, from, start) => {
    const loaded = transcript(user('u1'), reply('a1', 'One'), user('u2'), reply('a2', 'Two'));
    expect(runs([loaded, start], from)).toMatchObject([{ after: at('u2'), exact: false }]);
  });

  it('is counted again when the history arrives under a run only a send or a side band told of', () => {
    const early = [SEND, transcript(user('u1'), reply('a1', 'One'), user('u2'), reply('a2', 'Two'))];
    const loaded = runs([...early, { ...START, replayed: true }], createChatThreadState('c'));
    expect(loaded).toEqual([{ after: at('u2'), exact: false }]);
    const known = reduce([{ ...START, startedAtMs: 5, replayed: true }, transcript(user('u1'), reply('a1', 'One'))]);
    expect(runs([{ ...START, startedAtMs: 5, replayed: true }], known)[0]).toMatchObject({ after: null });
  });

  it('stays where it was seen to be when a reconnect only says that a run goes', () => {
    const seen = [transcript(user('u1')), START, transcript(user('u1'), reply('a1', 'One'), user('u2'))];
    expect(runs([...seen, { ...START, replayed: true }])).toMatchObject([{ after: at('u1'), exact: true }]);
  });

  it('is not known after a failure nobody explained', () => {
    const failed: ChatStateEvent[] = [
      START,
      transcript(user('u1'), reply('a1', 'One')),
      { type: 'run.failed', error: 'x' },
    ];
    expect(runs([...failed, START])[1]).toMatchObject({ after: at('u1'), exact: false });
  });

  it('is another run’s when the daemon names another start', () => {
    const one = [{ ...START, startedAtMs: 5 }, transcript(user('u1'), reply('a1', 'One'))];
    expect(runs([...one, { ...START, startedAtMs: 9 }])).toEqual([
      { after: null, exact: true, startedAtMs: 5, end: { until: at('a1') } },
      { after: at('a1'), exact: true, startedAtMs: 9 },
    ]);
    // Away while it changed: where the one before ended isn't known.
    expect(runs([...one, { ...START, startedAtMs: 9, replayed: true }])).toEqual([
      { after: at('u1'), exact: false, startedAtMs: 9 },
    ]);
  });

  it('is known after a send that reached nobody', () => {
    const done = transcript(user('u1'), reply('a1', 'One'));
    const queued = { type: 'local.message.queued', pending } as const;
    const failed = reduce([done, queued, SEND, fail]);
    expect(failed.runState.type).toBe('error');
    expect(runs([SEND], failed)[1]).toEqual({ after: at('a1'), exact: true, optimistic: true });
  });
});

describe('where a run ends', () => {
  const going = [START, transcript(user('u1'), reply('a1', 'One'))];

  it('takes the daemon’s reason at once, and the settled stop adds nothing', () => {
    const over = [{ after: null, exact: true, end: { until: at('a1'), reason: 'cancelled' } }];
    expect(runs([...going, ended('cancelled')])).toEqual(over);
    expect(reduce([...going, ended('cancelled')]).runState.type).toBe('running');
    expect(runs([...going, ended('cancelled'), STOPPED])).toEqual(over);
    expect(runs([...going, ended('cancelled'), STOPPED, ended('end_turn')])).toEqual(over);
  });

  it('starts another run when one begins before the stop has settled', () => {
    expect(runs([...going, ended('end_turn'), START])).toEqual([
      { after: null, exact: true, end: { until: at('a1'), reason: 'end_turn' } },
      { after: at('a1'), exact: true },
    ]);
  });

  it('has no reason when the stop has none, until the daemon gives it', () => {
    expect(runs([...going, STOPPED])).toEqual([{ after: null, exact: true, end: { until: at('a1') } }]);
    const failed = [...going, { type: 'run.failed', error: 'x' } as const];
    expect(runs(failed)).toEqual([{ after: null, exact: true, end: { until: at('a1') } }]);
    const later = [...failed, transcript(user('u1'), reply('a1', 'One'), reply('a2', 'Two')), ended('end_turn')];
    expect(runs(later)).toEqual([{ after: null, exact: true, end: { until: at('a1'), reason: 'end_turn' } }]);
  });

  it('tells nothing of a thread no run was seen in', () => {
    expect(runs([ended('end_turn'), STOPPED])).toEqual([]);
  });

  it('is not a steer that failed: the run goes on', () => {
    const state = reduce([...going, { type: 'local.message.queued', pending }, SEND, fail]);
    expect(state.runState.type).toBe('running');
    expect(state.runs).toEqual([{ after: null, exact: true }]);
    expect(state.pendingUserMessages.p).toMatchObject({ status: 'failed' });
  });

  it('forgets the runs of a transcript that was cleared', () => {
    expect(runs([...going, { type: 'transcript.cleared' }])).toEqual([]);
  });
});

it('counts only the parts that show', () => {
  expect(visibleParts('hi')).toBe(1);
  expect(visibleParts(' ')).toBe(0);
  expect(
    visibleParts([
      { type: 'text', text: ' ' },
      { type: 'reasoning', text: '' },
      { type: 'reasoning', text: 'Hm' },
      { type: 'tool-call' },
    ]),
  ).toBe(2);
});
