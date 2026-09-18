/**
 * Behavior tests for `handleDaemonEvent` — error routing and chatId
 * filtering. The transcript/gate/queue/usage/compaction families ride the
 * ACP facade now (see acp-session-plane.test.ts).
 *
 * Pure function tests: fixed input events, hardcoded expected HandleResult
 * values. No logic from the implementation is re-derived.
 */
import { describe, it, expect } from 'vitest';
import { handleDaemonEvent } from '../handle-daemon-event';

const CHAT_ID = 'chat-abc';
const OTHER_CHAT = 'chat-other';

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
