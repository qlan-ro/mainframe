/**
 * A trailing USER message must not stop the running-status search: the tail
 * walk looks backward for the nearest ASSISTANT message, not literally the
 * last entry in `state.messages` — an acked user bubble that lands after
 * the streaming assistant turn (order is server-authoritative, taken
 * verbatim from `transcript.updated`) must not steal or block the "running"
 * status from the assistant still streaming ahead of it.
 */
import { describe, it, expect } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { reduceChatThreadState, createChatThreadState } from '../chat-thread-state.js';
import { projectChatThreadMessages } from '../project-messages.js';

const asst = (id: string): ThreadMessageLike => ({
  id,
  role: 'assistant',
  content: [{ type: 'text', text: 'streaming…' }],
});
const user = (id: string): ThreadMessageLike => ({ id, role: 'user', content: [{ type: 'text', text: id }] });

describe('ack-during-stream — a trailing user bubble does not block the assistant running status', () => {
  it('the assistant ahead of a trailing user message still shows running; the user message never does', () => {
    let state = createChatThreadState('c1');
    state = reduceChatThreadState(state, { type: 'run.started' });
    // Server order: assistant streaming, then a just-acked user bubble at the tail.
    state = reduceChatThreadState(state, { type: 'transcript.updated', messages: [asst('a1'), user('q')] });

    expect(state.messages.map((m) => m.id)).toEqual(['a1', 'q']);

    const projected = projectChatThreadMessages(state);
    const a1 = projected.find((m) => m.id === 'a1') as { status?: { type?: string } };
    const q = projected.find((m) => m.id === 'q') as { status?: { type?: string } };

    expect(a1.status?.type).toBe('running');
    expect(q.status?.type ?? 'complete').not.toBe('running');
  });
});
