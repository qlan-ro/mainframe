import { describe, it, expect } from 'vitest';
import { reduceChatThreadState, createChatThreadState } from '../chat-thread-state.js';
import { projectChatThreadMessages } from '../project-messages.js';
import type { DisplayMessage } from '@qlan-ro/mainframe-types';

const asst = (id: string): DisplayMessage =>
  ({
    id,
    chatId: 'c1',
    type: 'assistant',
    content: [{ type: 'text', text: 'streaming…' }],
    timestamp: '2026-07-04T00:00:00Z',
  }) as never;
const user = (id: string): DisplayMessage =>
  ({
    id,
    chatId: 'c1',
    type: 'user',
    content: [{ type: 'text', text: id }],
    timestamp: '2026-07-04T00:00:01Z',
  }) as never;

describe('ack-during-stream — user bubble moves to tail, assistant keeps the running status', () => {
  it('final order ends with the moved user bubble and the assistant is marked running', () => {
    let state = createChatThreadState('c1');
    state = reduceChatThreadState(state, { type: 'run.started' });
    // Post-move order from the daemon: assistant streaming, then the just-acked user bubble at the tail.
    state = reduceChatThreadState(state, { type: 'history.loaded', messages: [asst('a1'), user('q')] });

    expect(state.messageOrder).toEqual(['a1', 'q']);

    const projected = projectChatThreadMessages(state);
    const ids = projected.map((m) => m.id);
    // The moved user bubble is last; the assistant sits just before it.
    expect(ids.slice(-2)).toEqual(['a1', 'q']);
    const a1 = projected.find((m) => m.id === 'a1')!;
    const q = projected.find((m) => m.id === 'q')!;
    // Streaming still targets the assistant, not the trailing user bubble.
    expect((a1 as any).status?.type).toBe('running');
    expect((q as any).status?.type ?? 'complete').not.toBe('running');
  });
});
