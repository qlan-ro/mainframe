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

describe('queuePosition', () => {
  it('returns position=1, total=1 for a single queued message', () => {
    const queued = [ref('m1', '2026-07-02T10:00:00.000Z')];
    expect(queuePosition(queued, 'm1')).toEqual({ position: 1, total: 1 });
  });

  it('returns position=1, total=3 for the earliest of three queued messages', () => {
    const queued = [
      ref('m1', '2026-07-02T10:00:00.000Z'),
      ref('m2', '2026-07-02T10:00:01.000Z'),
      ref('m3', '2026-07-02T10:00:02.000Z'),
    ];
    expect(queuePosition(queued, 'm1')).toEqual({ position: 1, total: 3 });
  });

  it('returns position=2, total=3 for the second-earliest of three queued messages', () => {
    const queued = [
      ref('m1', '2026-07-02T10:00:00.000Z'),
      ref('m2', '2026-07-02T10:00:01.000Z'),
      ref('m3', '2026-07-02T10:00:02.000Z'),
    ];
    expect(queuePosition(queued, 'm2')).toEqual({ position: 2, total: 3 });
  });

  it('orders strictly by timestamp regardless of input array order', () => {
    const queued = [
      ref('m3', '2026-07-02T10:00:02.000Z'),
      ref('m1', '2026-07-02T10:00:00.000Z'),
      ref('m2', '2026-07-02T10:00:01.000Z'),
    ];
    expect(queuePosition(queued, 'm3')).toEqual({ position: 3, total: 3 });
  });

  it('returns position=1, total=1 when the messageId is not found in the queue', () => {
    const queued = [ref('m1', '2026-07-02T10:00:00.000Z')];
    expect(queuePosition(queued, 'missing')).toEqual({ position: 1, total: 1 });
  });

  it('returns position=1, total=1 for an empty queue', () => {
    expect(queuePosition([], 'm1')).toEqual({ position: 1, total: 1 });
  });
});
