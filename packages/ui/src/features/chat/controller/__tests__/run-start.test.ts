/** Where the run in progress began, from the events the controller reduces. */
import { describe, expect, it } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { ChatStateEvent, ChatThreadState } from '../chat-thread-state';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';

const user = (id: string): ThreadMessageLike => ({ id, role: 'user', content: 'hi' });
const reply = (id: string): ThreadMessageLike => ({ id, role: 'assistant', content: 'ok' });
const transcript = (...messages: ThreadMessageLike[]): ChatStateEvent => ({ type: 'transcript.updated', messages });
const ready: ChatThreadState = { ...createChatThreadState('c'), loadState: { type: 'ready' } };
const reduce = (events: ChatStateEvent[], from = ready) => events.reduce(reduceChatThreadState, from);
const run = (events: ChatStateEvent[], from = ready) => reduce(events, from).run;

const START = { type: 'run.started' } as const;
const SEND = { type: 'run.started', optimistic: true } as const;
const at = (startedAtMs: number) => ({ ...START, startedAtMs });
const pending = { clientId: 'p', chatId: 'c', text: 'x', createdAt: 1, status: 'pending' } as const;
const queued = { type: 'local.message.queued', pending } as const;
const fail = { type: 'local.message.failed', clientId: 'p', error: 'x', stage: 'send' } as const;
const loaded = transcript(user('u1'), reply('a1'), user('u2'), reply('a2'));
const UNSEEN = { confirmed: true };

describe('where the run began', () => {
  it('is the idle → running edge', () => {
    expect(run([START])).toEqual({ after: null, confirmed: true });
    expect(run([loaded, START])).toEqual({ after: 'a2', confirmed: true });
  });

  it('never moves while the run goes: steers, sends, frames, replays, cancelling', () => {
    const begun = reduce([transcript(user('u1')), SEND, transcript(user('u1'), reply('a1')), at(5)]);
    expect(begun.run).toEqual({ after: 'u1', confirmed: true });
    const more = [START, SEND, transcript(user('u1'), reply('a1'), user('u2')), at(5), { ...at(5), replayed: true }];
    expect(run([...more, { type: 'run.cancelling' }, START, { ...START, replayed: true }], begun)).toBe(begun.run);
  });

  it.each([
    ['a replay', ready, { ...START, replayed: true }],
    ['a transcript that has not loaded', createChatThreadState('c'), START],
  ] as const)('is not known from %s', (_name, from, start) => {
    expect(run([loaded, start], from)).toEqual(UNSEEN);
  });

  it('stays unknown when a live frame follows', () => {
    expect(run([loaded, { ...START, replayed: true }, START, at(5), at(5)])).toEqual(UNSEEN);
    expect(run([SEND, loaded, { ...START, replayed: true }], createChatThreadState('c'))).toEqual(UNSEEN);
  });

  it('is another run’s when the daemon names another start', () => {
    const one = [at(5), transcript(user('u1'), reply('a1'))];
    expect(run([...one, at(9)])).toEqual({ after: 'a1', confirmed: true });
    // Away while it changed.
    expect(run([...one, { ...at(9), replayed: true }])).toEqual(UNSEEN);
  });
});

describe('the run is forgotten', () => {
  it.each([
    ['stops', { type: 'run.stopped' }],
    ['fails', { type: 'run.failed', error: 'x' }],
    ['has its transcript cleared', { type: 'transcript.cleared' }],
  ] as const)('when the session %s', (_how, event) => {
    expect(run([loaded, START, event])).toBeNull();
  });

  it('when nobody but the send that failed told of it', () => {
    const failed = reduce([loaded, queued, SEND, fail]);
    expect([failed.run, failed.runState.type]).toEqual([null, 'error']);
    expect(run([SEND], failed)).toEqual({ after: 'a2', confirmed: false });
  });

  it('not when a steer fails: the run goes on', () => {
    const state = reduce([loaded, START, queued, SEND, fail]);
    expect(state.run).toEqual({ after: 'a2', confirmed: true });
    expect(state.runState.type).toBe('running');
    expect(state.pendingUserMessages.p).toMatchObject({ status: 'failed' });
  });
});
