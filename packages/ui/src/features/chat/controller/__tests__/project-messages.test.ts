/**
 * Regression tests for projectChatThreadRepository / projectChatThreadMessages.
 *
 * Bug fixed (still guarded): projectPendingMessage previously set
 * `status: { type: 'complete', reason: 'unknown' }` on the user-role object
 * it returned. assistant-ui's fromThreadMessageLike (invoked by
 * ExportedMessageRepository.fromArray) throws "status is only supported for
 * assistant messages" for any non-assistant message that carries a `status`
 * field. The first optimistic send therefore crashed the entire thread.
 *
 * The desktop-cutover pass simplified the projection: `state.messages` now
 * arrives pre-converted (via AcpSessionPlane → convertAcpItems) instead of
 * raw DisplayMessage objects the projection used to convert+memoize itself.
 * The per-message conversion-memoization suite this file used to carry is
 * retired along with that conversion step — there is nothing left to
 * memoize; `projectChatThreadMessages` now just maps `state.messages`
 * through a type cast.
 */
import { describe, it, expect } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
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

    expect(projected.role).toBe('user');
    // The `status` property must be absent — its presence triggers the
    // "status is only supported for assistant messages" runtime throw.
    expect('status' in projected).toBe(false);
    expect(projected.content).toEqual([{ type: 'text', text: 'hello world' }]);
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
// `running` while a run is active so assistant-ui's useSmooth reveals its
// text character-by-character. Historical/idle messages stay complete.
// `state.messages` arrives pre-converted now (AcpSessionPlane's
// transcript.updated), so fixtures are ThreadMessageLike directly.
// ---------------------------------------------------------------------------

function textMessage(id: string, role: ThreadMessageLike['role'], text: string): ThreadMessageLike {
  return { id, role, content: [{ type: 'text', text }] } as ThreadMessageLike;
}

/** Seeds pre-converted server messages via `transcript.updated`, then optionally flips the run active. */
function stateWithMessages(messages: ThreadMessageLike[], running: boolean) {
  let state = reduceChatThreadState(createChatThreadState('chat-1'), { type: 'transcript.updated', messages });
  if (running) state = reduceChatThreadState(state, { type: 'run.started' });
  return state;
}

/** Narrow read of an optional assistant status. */
function statusTypeOf(msg: unknown): string | undefined {
  return (msg as { status?: { type?: string } }).status?.type;
}

describe('projectChatThreadMessages — streaming assistant status', () => {
  it('marks the tail assistant message running while the run is active', () => {
    const state = stateWithMessages(
      [textMessage('u1', 'user', 'hi'), textMessage('a1', 'assistant', 'partial repl')],
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
        textMessage('a-old', 'assistant', 'first turn answer'),
        textMessage('u2', 'user', 'follow up'),
        textMessage('a-new', 'assistant', 'second turn stream'),
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
      [textMessage('u1', 'user', 'hi'), textMessage('a1', 'assistant', 'complete answer')],
      false,
    );

    const messages = projectChatThreadMessages(state);
    const tail = messages[messages.length - 1]!;

    expect(tail.role).toBe('assistant');
    expect(statusTypeOf(tail)).not.toBe('running');
  });

  it('builds a repository without throwing when the tail assistant is running (fromArray integration)', () => {
    const state = stateWithMessages(
      [textMessage('u1', 'user', 'hi'), textMessage('a1', 'assistant', 'streaming…')],
      true,
    );
    expect(() => projectChatThreadRepository(state)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test 4: a failed pending is projected as a classified sentence (todo #219)
// ---------------------------------------------------------------------------

/** Seeds a failed pending through the official reducer events. */
function stateWithFailedPending(error: unknown, stage?: 'upload' | 'send', restored = false) {
  const pending = makePending();
  const queued = stateWithPending(pending);
  const failed = reduceChatThreadState(queued, {
    type: 'local.message.failed',
    clientId: pending.clientId,
    error,
    stage,
  });
  return restored
    ? reduceChatThreadState(failed, { type: 'local.message.attachments_restored', clientId: pending.clientId })
    : failed;
}

function mainframeMetaOf(state: Parameters<typeof projectChatThreadMessages>[0]) {
  const messages = projectChatThreadMessages(state);
  const projected = messages[messages.length - 1]!;
  return (
    projected.metadata as {
      custom: { mainframe: { error?: string; attachmentsRestored?: boolean } };
    }
  ).custom.mainframe;
}

describe('projectChatThreadMessages — failed pending classification', () => {
  it('projects an upload-stage 401 without the restore clause until the runtime confirms restore', () => {
    const state = stateWithFailedPending(Object.assign(new Error('Unauthorized'), { status: 401 }), 'upload');

    expect(mainframeMetaOf(state).error).toBe(
      'Not authorized on this daemon. Re-pair it from the daemon menu, then send again.',
    );
    expect(mainframeMetaOf(state).attachmentsRestored).toBe(false);
  });

  it('adds the restore clause and hides Retry only after the restore signal', () => {
    const state = stateWithFailedPending(Object.assign(new Error('Unauthorized'), { status: 401 }), 'upload', true);

    expect(mainframeMetaOf(state).error).toBe(
      'Not authorized on this daemon. Re-pair it from the daemon menu, then send again. Your attachments are back in the composer.',
    );
    expect(mainframeMetaOf(state).attachmentsRestored).toBe(true);
  });

  it('uses the restore signal even when the upload succeeded and the WS send threw', () => {
    const state = stateWithFailedPending(Object.assign(new Error('Unauthorized'), { status: 401 }), 'send', true);

    expect(mainframeMetaOf(state).error).toBe(
      'Not authorized on this daemon. Re-pair it from the daemon menu, then send again. Your attachments are back in the composer.',
    );
    expect(mainframeMetaOf(state).attachmentsRestored).toBe(true);
  });

  it('projects a send-stage failure without the restore clause when nothing was restored', () => {
    const state = stateWithFailedPending(Object.assign(new Error('Unauthorized'), { status: 401 }), 'send');

    expect(mainframeMetaOf(state).error).toBe(
      'Not authorized on this daemon. Re-pair it from the daemon menu, then send again.',
    );
    expect(mainframeMetaOf(state).attachmentsRestored).toBe(false);
  });

  it('carries no error or attachmentsRestored while the pending is still in flight', () => {
    const meta = mainframeMetaOf(stateWithPending(makePending()));

    expect(meta.error).toBeUndefined();
    expect(meta.attachmentsRestored).toBeUndefined();
  });
});
