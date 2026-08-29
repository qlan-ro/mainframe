/**
 * Behavior tests for `handleDaemonEvent` — queued.snapshot routing, plus
 * chatId filtering (fix #4).
 *
 * Pure function tests: fixed input events, hardcoded expected HandleResult
 * values. No logic from the implementation is re-derived.
 */
import { describe, it, expect } from 'vitest';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { handleDaemonEvent } from '../handle-daemon-event';

const CHAT_ID = 'chat-abc';
const OTHER_CHAT = 'chat-other';
function makeRef(uuid: string): QueuedMessageRef {
  return { uuid, content: `msg-${uuid}` } as unknown as QueuedMessageRef;
}

// ---------------------------------------------------------------------------
// message.queued.snapshot
// ---------------------------------------------------------------------------

describe('handleDaemonEvent — message.queued.snapshot', () => {
  it('returns queued.snapshot event with refs when chatId matches', () => {
    const result = handleDaemonEvent(
      {
        type: 'message.queued.snapshot',
        chatId: CHAT_ID,
        refs: [makeRef('A'), makeRef('B')],
      },
      CHAT_ID,
    );

    expect(result).toEqual({
      kind: 'event',
      event: {
        type: 'queued.snapshot',
        refs: [makeRef('A'), makeRef('B')],
      },
    });
  });

  it('returns noop when chatId does not match', () => {
    const result = handleDaemonEvent(
      {
        type: 'message.queued.snapshot',
        chatId: OTHER_CHAT,
        refs: [makeRef('A')],
      },
      CHAT_ID,
    );

    expect(result).toEqual({ kind: 'noop' });
  });

  it('preserves the refs array exactly — no re-ordering or filtering', () => {
    const refs = [makeRef('Z'), makeRef('M'), makeRef('A')];
    const result = handleDaemonEvent({ type: 'message.queued.snapshot', chatId: CHAT_ID, refs }, CHAT_ID);

    expect(result.kind).toBe('event');
    if (result.kind === 'event' && result.event.type === 'queued.snapshot') {
      expect(result.event.refs).toEqual([makeRef('Z'), makeRef('M'), makeRef('A')]);
    }
  });

  it('handles an empty refs array', () => {
    const result = handleDaemonEvent({ type: 'message.queued.snapshot', chatId: CHAT_ID, refs: [] }, CHAT_ID);

    expect(result).toEqual({
      kind: 'event',
      event: { type: 'queued.snapshot', refs: [] },
    });
  });
});

// ---------------------------------------------------------------------------
// error
// ---------------------------------------------------------------------------

describe('handleDaemonEvent — error', () => {
  it('returns run.failed when chatId matches this chat', () => {
    const result = handleDaemonEvent({ type: 'error', chatId: CHAT_ID, error: 'boom' }, CHAT_ID);

    expect(result).toEqual({
      kind: 'event',
      event: { type: 'run.failed', error: 'boom' },
    });
  });

  it('returns run.failed when chatId is absent (global error applies to current run)', () => {
    const result = handleDaemonEvent({ type: 'error', error: 'boom' }, CHAT_ID);

    expect(result).toEqual({
      kind: 'event',
      event: { type: 'run.failed', error: 'boom' },
    });
  });

  it('returns noop when chatId targets a different chat', () => {
    const result = handleDaemonEvent({ type: 'error', chatId: OTHER_CHAT, error: 'boom' }, CHAT_ID);

    expect(result).toEqual({ kind: 'noop' });
  });
});
