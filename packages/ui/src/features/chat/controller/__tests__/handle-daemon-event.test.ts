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
// chat.updated isRunning — facadeAttached gating (D7, finding 9/10)
// ---------------------------------------------------------------------------

describe('handleDaemonEvent — chat.updated isRunning, facadeAttached gating', () => {
  it('isRunning: false is a noop while the facade is attached — its own idle state_update is the only stop signal', () => {
    const result = handleDaemonEvent(
      { type: 'chat.updated', chat: { id: CHAT_ID, isRunning: false } } as never,
      CHAT_ID,
      true,
    );

    expect(result).toEqual({ kind: 'noop' });
  });

  it('isRunning: false still maps to run.stopped while the facade is NOT attached (the backstop)', () => {
    const result = handleDaemonEvent(
      { type: 'chat.updated', chat: { id: CHAT_ID, isRunning: false } } as never,
      CHAT_ID,
      false,
    );

    expect(result).toEqual({ kind: 'event', event: { type: 'run.stopped' } });
  });

  it('isRunning: true maps to run.started regardless of facadeAttached', () => {
    const attached = handleDaemonEvent(
      { type: 'chat.updated', chat: { id: CHAT_ID, isRunning: true } } as never,
      CHAT_ID,
      true,
    );
    const detached = handleDaemonEvent(
      { type: 'chat.updated', chat: { id: CHAT_ID, isRunning: true } } as never,
      CHAT_ID,
      false,
    );

    expect(attached).toEqual({ kind: 'event', event: { type: 'run.started' } });
    expect(detached).toEqual({ kind: 'event', event: { type: 'run.started' } });
  });
});

// ---------------------------------------------------------------------------
// error
// ---------------------------------------------------------------------------

describe('handleDaemonEvent — error', () => {
  it('returns run.failed when chatId matches this chat', () => {
    const result = handleDaemonEvent({ type: 'error', chatId: CHAT_ID, error: 'boom' }, CHAT_ID, false);

    expect(result).toEqual({
      kind: 'event',
      event: { type: 'run.failed', error: 'boom' },
    });
  });

  it('returns run.failed when chatId is absent (global error applies to current run)', () => {
    const result = handleDaemonEvent({ type: 'error', error: 'boom' }, CHAT_ID, false);

    expect(result).toEqual({
      kind: 'event',
      event: { type: 'run.failed', error: 'boom' },
    });
  });

  it('returns noop when chatId targets a different chat', () => {
    const result = handleDaemonEvent({ type: 'error', chatId: OTHER_CHAT, error: 'boom' }, CHAT_ID, false);

    expect(result).toEqual({ kind: 'noop' });
  });
});
