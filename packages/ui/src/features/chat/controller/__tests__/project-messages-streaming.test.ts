/**
 * `projectChatThreadMessages` — the tail-running fallback (D6/D7, long-chat-
 * and-streaming plan task U3): `cancelling` counts as running, idle history
 * is never stamped, and a message that already carries its own `running`
 * status (D6, from `convert-acp-item.ts`) is never second-guessed.
 *
 * The "a user message follows the tail" guard from the plan is NOT
 * implemented here — `project-messages-ack-during-stream.test.ts` already
 * pins the opposite behavior (a just-acked user bubble landing after the
 * streaming assistant in server order must not steal or block its running
 * status), and the two requirements are structurally indistinguishable from
 * `state.messages` alone: both reduce to the same `[assistant, user]` tail
 * shape. Left as-is; flagged in the task report.
 */
import { describe, it, expect } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';
import { projectChatThreadMessages } from '../project-messages';

const asst = (id: string, extra: Partial<ThreadMessageLike> = {}): ThreadMessageLike => ({
  id,
  role: 'assistant',
  content: [{ type: 'text', text: 'hi' }],
  ...extra,
});

function statusOf(messages: ThreadMessageLike[], id: string): { type?: string } | undefined {
  return (messages.find((m) => m.id === id) as { status?: { type?: string } }).status;
}

describe('projectChatThreadMessages — cancelling counts as running (D7)', () => {
  it('keeps the current turn tail running while cancelling, not just while running', () => {
    let state = createChatThreadState('c1');
    state = reduceChatThreadState(state, { type: 'run.started' });
    state = reduceChatThreadState(state, { type: 'transcript.updated', messages: [asst('a1')] });
    state = reduceChatThreadState(state, { type: 'run.cancelling' });

    const projected = projectChatThreadMessages(state);
    expect(statusOf(projected, 'a1')).toEqual({ type: 'running' });
  });
});

describe('projectChatThreadMessages — idle history is never running', () => {
  it('an idle thread never stamps the last assistant message running', () => {
    let state = createChatThreadState('c1');
    state = reduceChatThreadState(state, { type: 'transcript.updated', messages: [asst('a1')] });

    const projected = projectChatThreadMessages(state);
    expect(statusOf(projected, 'a1')).toBeUndefined();
  });
});

describe('projectChatThreadMessages — a streaming container keeps its own status (D6)', () => {
  it('does not re-stamp (or double-process) a message that already carries status: running', () => {
    let state = createChatThreadState('c1');
    state = reduceChatThreadState(state, { type: 'run.started' });
    state = reduceChatThreadState(state, {
      type: 'transcript.updated',
      messages: [
        asst('a1', { content: [{ type: 'text', text: 'done' }] }),
        asst('a2', { status: { type: 'running' } }),
      ],
    });

    const projected = projectChatThreadMessages(state);
    // The fallback's own stamp target (the LAST assistant message) already
    // carries its own status — the fallback must leave it alone rather than
    // overwriting it, and must not fall through to an earlier message either.
    expect(statusOf(projected, 'a2')).toEqual({ type: 'running' });
    expect(statusOf(projected, 'a1')).toBeUndefined();
  });
});
