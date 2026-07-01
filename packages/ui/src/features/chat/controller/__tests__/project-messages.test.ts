/**
 * Regression tests for projectChatThreadRepository / projectChatThreadMessages.
 *
 * Bug fixed: projectPendingMessage previously set `status: { type: 'complete', reason: 'unknown' }`
 * on the user-role object it returned. assistant-ui's fromThreadMessageLike (invoked by
 * ExportedMessageRepository.fromArray) throws "status is only supported for assistant messages"
 * for any non-assistant message that carries a `status` field. The first optimistic send
 * therefore crashed the entire thread.
 *
 * Fix: removed the `status` field from the user-message projection.
 */
import { describe, it, expect } from 'vitest';
import type { DisplayMessage } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState, type PendingUserMessage } from '../chat-thread-state';
import { projectChatThreadMessages, projectChatThreadRepository } from '../project-messages';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Builds a minimal PendingUserMessage in the 'pending' status. */
function makePending(overrides?: Partial<PendingUserMessage>): PendingUserMessage {
  return {
    clientId: 'client-abc',
    chatId: 'chat-1',
    text: 'hello world',
    createdAt: 1_700_000_000_000,
    status: 'pending',
    ...overrides,
  };
}

/** Returns a ChatThreadState that contains exactly one pending user message,
 *  seeded via the official `local.message.queued` reducer event — not a
 *  hand-rolled object that could drift from the real shape. */
function stateWithPending(pending: PendingUserMessage) {
  const base = createChatThreadState('chat-1');
  return reduceChatThreadState(base, { type: 'local.message.queued', pending });
}

// ---------------------------------------------------------------------------
// Test 1: projected optimistic user message shape
// ---------------------------------------------------------------------------

describe('projectChatThreadMessages — pending user message projection', () => {
  it('produces a user-role message with no status field, keeps text and pending metadata', () => {
    const pending = makePending();
    const state = stateWithPending(pending);

    const messages = projectChatThreadMessages(state);

    expect(messages).toHaveLength(1);
    const projected = messages[0]!;

    // Role must be user.
    expect(projected.role).toBe('user');

    // The `status` property must be absent — its presence triggers the
    // "status is only supported for assistant messages" runtime throw.
    expect('status' in projected).toBe(false);

    // Text content is preserved verbatim.
    expect(projected.content).toEqual([{ type: 'text', text: 'hello world' }]);

    // Optimistic sentinel is present so the UI can render a spinner.
    expect((projected.metadata as { custom: { mainframe: { pending: boolean } } }).custom.mainframe.pending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: integration guard — fromArray must not throw
// ---------------------------------------------------------------------------

describe('projectChatThreadRepository — fromArray integration', () => {
  it('does not throw when the state contains a pending user message (regression: status field crash)', () => {
    const pending = makePending({ clientId: 'client-xyz', text: 'first send' });
    const state = stateWithPending(pending);

    // This is exactly the call path that crashed before the fix:
    // projectChatThreadMessages → projectPendingMessage → ExportedMessageRepository.fromArray.
    expect(() => {
      projectChatThreadRepository(state);
    }).not.toThrow();
  });

  it('does not throw when the state is empty (baseline — no messages)', () => {
    const state = createChatThreadState('chat-empty');
    expect(() => {
      projectChatThreadRepository(state);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test 3: streaming "typing" status — the tail assistant message is marked
// `running` while a run is active so assistant-ui's useSmooth reveals its text
// character-by-character. Historical/idle messages stay complete (instant).
// ---------------------------------------------------------------------------

function makeDisplayMessage(id: string, type: DisplayMessage['type'], text: string): DisplayMessage {
  return { id, chatId: 'chat-1', type, content: [{ type: 'text', text }], timestamp: '2026-07-01T00:00:00.000Z' };
}

/** Seeds server messages via the official `history.loaded` reducer, then optionally
 *  flips the run active via `run.started` — never a hand-rolled state object. */
function stateWithMessages(messages: DisplayMessage[], running: boolean) {
  let state = reduceChatThreadState(createChatThreadState('chat-1'), { type: 'history.loaded', messages });
  if (running) state = reduceChatThreadState(state, { type: 'run.started' });
  return state;
}

/** Narrow read of an optional assistant status (convertMessage omits it → undefined). */
function statusTypeOf(msg: unknown): string | undefined {
  return (msg as { status?: { type?: string } }).status?.type;
}

describe('projectChatThreadMessages — streaming assistant status', () => {
  it('marks the tail assistant message running while the run is active', () => {
    const state = stateWithMessages(
      [makeDisplayMessage('u1', 'user', 'hi'), makeDisplayMessage('a1', 'assistant', 'partial repl')],
      true,
    );

    const messages = projectChatThreadMessages(state);
    const tail = messages[messages.length - 1]!;

    expect(tail.role).toBe('assistant');
    expect(statusTypeOf(tail)).toBe('running');
  });

  it('leaves an EARLIER assistant message complete — only the tail streams', () => {
    const state = stateWithMessages(
      [
        makeDisplayMessage('a-old', 'assistant', 'first turn answer'),
        makeDisplayMessage('u2', 'user', 'follow up'),
        makeDisplayMessage('a-new', 'assistant', 'second turn stream'),
      ],
      true,
    );

    const messages = projectChatThreadMessages(state);
    const oldAssistant = messages.find((m) => m.id === 'a-old')!;
    const newAssistant = messages.find((m) => m.id === 'a-new')!;

    expect(statusTypeOf(newAssistant)).toBe('running');
    expect(statusTypeOf(oldAssistant)).not.toBe('running');
  });

  it('does NOT mark the tail assistant running when the run is idle (loaded history is instant)', () => {
    const state = stateWithMessages(
      [makeDisplayMessage('u1', 'user', 'hi'), makeDisplayMessage('a1', 'assistant', 'complete answer')],
      false,
    );

    const messages = projectChatThreadMessages(state);
    const tail = messages[messages.length - 1]!;

    expect(tail.role).toBe('assistant');
    expect(statusTypeOf(tail)).not.toBe('running');
  });

  it('builds a repository without throwing when the tail assistant is running (fromArray integration)', () => {
    const state = stateWithMessages(
      [makeDisplayMessage('u1', 'user', 'hi'), makeDisplayMessage('a1', 'assistant', 'streaming…')],
      true,
    );
    // fromThreadMessageLike must accept the explicit running status on an assistant.
    expect(() => projectChatThreadRepository(state)).not.toThrow();
  });
});
