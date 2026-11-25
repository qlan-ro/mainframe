/**
 * A part says the same of its end through every window on the transcript and
 * from every moment somebody subscribes: nothing of an outcome is kept.
 */
import { expect, it } from 'vitest';
import type { ThreadMessage, ThreadMessageLike } from '@assistant-ui/react';
import {
  createChatThreadState,
  reduceChatThreadState,
  type ChatStateEvent,
  type ChatThreadState,
} from '../../../controller/chat-thread-state';
import { TranscriptProjector } from '../../../controller/transcript-projector';
import { zoneScope } from '../../../zones/subagent-outcome';
import { buildTurns, partState } from '../build-turns';
import { TurnCache } from '../turn-cache';
import { assistant, bash, presented, sources, system, text, user } from './fixtures';

type Said = Parameters<typeof presented>[0];
const turn = (state: NonNullable<Said>['state'], turnId: string) => presented({ state, turnId });
const placed = (...args: Parameters<typeof turn>) => ({ partSources: sources(1, turn(...args)) });
const open = { result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } };

/** Every kind of part, one under the other. */
const TRANSCRIPT: ThreadMessage[] = [
  user('u0'),
  assistant('finished', [bash('ls')], placed('completed', 't0')),
  user('u1'),
  assistant('nothing-said', [bash('ls'), text('Done')]),
  user('u2'),
  assistant('erred', [bash('ls')]),
  assistant('e2', [text('Boom')], { errorText: 'Boom' }),
  user('steer'),
  assistant('e3', [text('Boom')], { errorText: 'Boom' }),
  user('u3'),
  assistant('invalid-1', [bash('ls')], placed('invalid', 't3')),
  system('compacted', { isCompacted: true }),
  assistant('invalid', [text('Done')], placed('invalid', 't3')),
  user('u4'),
  assistant('cut-then-completed', [bash('ls'), text('Done')], {
    partSources: { 0: sources(1, turn('cancelled', 't4'))[0], 1: sources(1, turn('completed', 't5'))[0] },
  }),
  user('u5'),
  assistant('open', [bash('sleep', open)]),
  user('u6'),
  assistant('got-over-1', [bash('ls')], placed('completed', 't6')),
  assistant('e6', [text('Boom')], { errorText: 'Boom' }),
  assistant('got-over', [text('Done')], placed('completed', 't6')),
  user('u7'),
  assistant('stopped', [bash('ls')], placed('cancelled', 't7')),
  assistant('own-turn', [text('It came back')], placed('completed', 't8')),
  user('u8'),
  assistant('half', [text('I will now ch')], undefined, { status: { type: 'incomplete', reason: 'cancelled' } }),
  user('u9'),
  assistant('failed', [bash('ls')], placed('failed', 't9')),
];
const EXPECTED = {
  finished: 'finished',
  'nothing-said': 'neutral',
  erred: 'error',
  invalid: 'neutral',
  'cut-then-completed': 'neutral',
  open: 'neutral',
  'got-over': 'finished',
  stopped: 'stopped',
  'own-turn': 'finished',
  half: 'stopped',
  failed: 'error',
} as const;

/** As the converter hands them on: only an assistant message has a status, and a system one has its text. */
const LIKES = new Map(
  TRANSCRIPT.map(({ status, content, ...rest }) => {
    const like = { ...rest, content: content.length ? content : [{ type: 'text', text: '' }] };
    return [rest.id, (rest.role === 'assistant' ? { ...like, status } : like) as ThreadMessageLike];
  }),
);
const shows = (messages: readonly ThreadMessage[]): ChatStateEvent => ({
  type: 'transcript.updated',
  messages: messages.map(({ id }) => LIKES.get(id)!),
});
const START: ChatStateEvent = { type: 'run.started' };
const REPLAYED: ChatStateEvent = { type: 'run.started', replayed: true };
const STOPPED: ChatStateEvent = { type: 'run.stopped' };
const loaded = (messages: readonly ThreadMessage[]): ChatThreadState =>
  reduceChatThreadState(
    { ...createChatThreadState('chat'), authoritativeItemStreaming: true, loadState: { type: 'ready' } },
    shows(messages),
  );

/** Each part's state by its last message, as the chat's own transcript reads it. */
function statesOf(state: ChatThreadState, projector = new TranscriptProjector(), cache = new TurnCache()) {
  const { turns } = buildTurns(projector.projectMessages(state), zoneScope(state), cache);
  return Object.fromEntries([...turns.values()].map((part) => [part.lastMessageId, partState(part, false)]));
}
const size = TRANSCRIPT.length;
const within = (from: number, to = size) =>
  Object.fromEntries(
    Object.entries(EXPECTED).filter(([id]) => {
      const at = TRANSCRIPT.findIndex((message) => message.id === id);
      return at >= from && at < to;
    }),
  );

/** How the client learns of the run it finds when it subscribes. */
const SUBSCRIBED: [string, ChatStateEvent[]][] = [
  ['sees it start', [START]],
  ['is told by a replay', [REPLAYED]],
  ['misses its start', []],
];

it('is the same through every window', () => {
  for (let from = 0; from < size; from++) {
    const state = loaded(TRANSCRIPT.slice(from));
    expect(statesOf(state), `from ${from}`).toEqual(within(from));
  }
});

it.each(SUBSCRIBED)('is the same for who subscribes at any time and %s', (_how, learns) => {
  for (let from = 0; from < size; from++)
    for (let to = from; to <= size; to++) {
      const projector = new TranscriptProjector();
      const cache = new TurnCache();
      const at = `${from}–${to}`;
      let state = learns.reduce(reduceChatThreadState, loaded(TRANSCRIPT.slice(from, to)));
      for (let end = to + 1; end <= size; end++) {
        state = reduceChatThreadState(state, shows(TRANSCRIPT.slice(from, end)));
        // While it runs a part is going, or says what it will say in the end.
        for (const [id, shown] of Object.entries(statesOf(state, projector, cache)))
          if (shown !== 'going' && id in EXPECTED && learns.length)
            expect([id, shown], at).toEqual([id, EXPECTED[id as keyof typeof EXPECTED]]);
      }
      state = reduceChatThreadState(state, STOPPED);
      expect(statesOf(state, projector, cache), at).toEqual(within(from));
      // Paged back to the beginning, reconnected, then drawn again.
      state = reduceChatThreadState(state, shows(TRANSCRIPT));
      state = [REPLAYED, STOPPED].reduce(reduceChatThreadState, state);
      expect(statesOf(state, projector, cache), at).toEqual(EXPECTED);
      expect(statesOf(state), at).toEqual(EXPECTED);
    }
});
