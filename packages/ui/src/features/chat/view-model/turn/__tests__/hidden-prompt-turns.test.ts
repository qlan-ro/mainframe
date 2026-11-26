import { expect, it } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { buildTurns } from '../build-turns';
import { TurnCache } from '../turn-cache';
import type { TurnModel, TurnScope, TurnUnit } from '../types';
import { assistant, bash, presented, scope, sources, system, text, user } from './fixtures';

function timed(message: ThreadMessage, totalStreamTime: number) {
  if (message.role !== 'assistant') throw new Error('Expected an assistant fixture');
  return {
    ...message,
    metadata: {
      ...message.metadata,
      timing: { streamStartTime: 0, totalStreamTime, totalChunks: 0, toolCallCount: 0 },
    },
  };
}

const NOW = 1_700_000_100_000;
const build = (messages: ThreadMessage[], options: Partial<TurnScope> = {}, cache?: TurnCache) =>
  buildTurns(messages, scope(options), cache, NOW);
const label = ({ part }: TurnUnit) =>
  part.type === 'tool-call' ? part.toolName : part.type === 'text' ? part.text : part.type;
const roles = (model: TurnModel, id: string) => {
  const slice = model.slices.get(id)!;
  return { work: slice.work.map(label), markers: slice.markers.map(label), answer: slice.answer.map(label) };
};

it('preserves both answers and the event when a page supplies the earlier prompt group', () => {
  const first = timed(assistant('a1', [bash('check'), text('Full earlier answer')], { turnGroup: 'p1' }), 3200);
  const later = timed(
    assistant('a2', [text('Task reply')], {
      turnGroup: 'p2',
      hiddenPromptEvent: 'Tests finished',
    }),
    700,
  );
  const cache = new TurnCache();
  const current = build([later], {}, cache);
  expect(current.slices.get('a2')?.hiddenPromptEvent).toBe('Tests finished');
  const paged = build([user('u1'), first, later], {}, cache);
  expect(roles(paged, 'a1')).toEqual({ work: ['Bash'], markers: [], answer: ['Full earlier answer'] });
  expect(roles(paged, 'a2')).toEqual({ work: [], markers: [], answer: ['Task reply'] });
  expect(paged.slices.get('a1')?.footer).toBe(true);
  expect(paged.slices.get('a2')).toMatchObject({ header: true, footer: true, hiddenPromptEvent: 'Tests finished' });
  expect([...paged.turns.values()].map((turn) => turn.durationMs)).toEqual([3200, 700]);
});

it('keeps the earlier answer when a live Claude epoch arrives and then carries its notification', () => {
  const first = assistant('a1', [text('Earlier answer')], {
    partSources: sources(1, presented({ provider: 'claude', turnId: 't1' })),
  });
  const pending = assistant('a2', [text('Follow-up')], {
    partSources: sources(1, presented({ provider: 'claude', turnId: 't2', state: 'running' })),
  });
  const cache = new TurnCache();
  const active = build([user('u1'), first, pending], { isRunning: true, runAfter: 'a1' }, cache);
  expect(active.turns.size).toBe(2);
  expect(roles(active, 'a1').answer).toEqual(['Earlier answer']);
  const final = assistant('a2', [text('Follow-up')], {
    partSources: sources(1, presented({ provider: 'claude', turnId: 't2' })),
    hiddenPromptEvent: 'Background task finished',
  });
  const complete = build([user('u1'), first, final], {}, cache);
  expect(complete.slices.get('a2')?.hiddenPromptEvent).toBe('Background task finished');
  expect(roles(complete, 'a2').answer).toEqual(['Follow-up']);
});

it('keeps ordinary visible and unknown turns in their original structure', () => {
  const model = build([
    user('u1'),
    assistant('a1', [bash('check'), text('First')]),
    assistant('a2', [text('Second')]),
    user('u2'),
    assistant('a3', [text('Third')]),
  ]);
  expect([...model.turns.values()].map(({ lastMessageId, hasWork }) => [lastMessageId, hasWork])).toEqual([
    ['a2', true],
    ['a3', false],
  ]);
  expect([...model.slices.values()].map(({ messageId, header, footer }) => [messageId, header, footer])).toEqual([
    ['a1', true, false],
    ['a2', false, true],
    ['a3', false, true],
  ]);
});

it('keeps steer and compaction inside the turn until a queued prompt is delivered', () => {
  const first = [
    user('prompt'),
    assistant('work', [bash('pwd')], { turnGroup: 'first' }),
    user('steer', 'Use the other directory', { steered: true }),
    system('compact', { compaction: {} }),
    assistant('answer', [text('Done')], { turnGroup: 'first' }),
  ];
  const waiting = build([...first, user('next', 'Continue', { queued: true })]);
  expect(waiting.turns.size).toBe(1);
  expect(waiting.slices.get('answer')?.answer).toHaveLength(1);
  const delivered = build([...first, user('next'), assistant('reply', [text('Continued')], { turnGroup: 'second' })]);
  expect(delivered.turns.size).toBe(2);
});
