/**
 * queuePosition — behavior tests for FIFO position/total derivation (7.2).
 *
 * Each test provides a concrete queued-ref array + a target messageId and
 * asserts the exact { position, total } result — no logic is re-derived here.
 */
import { describe, it, expect } from 'vitest';
import { queuePosition } from '../queue-position';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';

function ref(messageId: string, timestamp: string): QueuedMessageRef {
  return { messageId, chatId: 'c1', uuid: `u-${messageId}`, content: 'x', timestamp };
}

const THREE_IN_ORDER = [
  ref('m1', '2026-07-02T10:00:00.000Z'),
  ref('m2', '2026-07-02T10:00:01.000Z'),
  ref('m3', '2026-07-02T10:00:02.000Z'),
];

const THREE_OUT_OF_ORDER = [
  ref('m3', '2026-07-02T10:00:02.000Z'),
  ref('m1', '2026-07-02T10:00:00.000Z'),
  ref('m2', '2026-07-02T10:00:01.000Z'),
];

describe('queuePosition', () => {
  it.each([
    ['single queued message', [ref('m1', '2026-07-02T10:00:00.000Z')], 'm1', { position: 1, total: 1 }],
    ['earliest of three queued messages', THREE_IN_ORDER, 'm1', { position: 1, total: 3 }],
    ['second-earliest of three queued messages', THREE_IN_ORDER, 'm2', { position: 2, total: 3 }],
    [
      'orders strictly by timestamp regardless of input array order',
      THREE_OUT_OF_ORDER,
      'm3',
      { position: 3, total: 3 },
    ],
    ['messageId not found in the queue', [ref('m1', '2026-07-02T10:00:00.000Z')], 'missing', { position: 1, total: 1 }],
    ['empty queue', [], 'm1', { position: 1, total: 1 }],
  ])('%s', (_label, queued, messageId, expected) => {
    expect(queuePosition(queued, messageId)).toEqual(expected);
  });
});
