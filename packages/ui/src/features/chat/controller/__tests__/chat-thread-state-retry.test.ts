/**
 * Reconnect status: the reducer's `retry` slice and the rule that decides which
 * session updates count as new content (todo #406). Hardcoded seeds and expectations.
 */
import { describe, expect, it } from 'vitest';
import type { SessionUpdate } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState, type ChatStateEvent } from '../chat-thread-state';
import { clearsRetryStatus } from '../retry-status-events';

function apply(events: ChatStateEvent[], seed = createChatThreadState('chat-1')) {
  return events.reduce(reduceChatThreadState, seed);
}
const retrying = (attempt = 2, maxAttempts?: number) =>
  apply([{ type: 'run.started' }, { type: 'retry.status', attempt, maxAttempts }]);

describe('reduceChatThreadState — retry', () => {
  it('starts with no retry', () => {
    expect(createChatThreadState('chat-1').retry).toBeNull();
  });

  it('records the attempt and maximum, and a later retry replaces them', () => {
    expect(retrying(2, 5).retry).toEqual({ attempt: 2, maxAttempts: 5 });
    expect(reduceChatThreadState(retrying(2, 5), { type: 'retry.status', attempt: 1, maxAttempts: 5 }).retry).toEqual({
      attempt: 1,
      maxAttempts: 5,
    });
  });

  it('keeps no maximum when the signal has none', () => {
    const retry = retrying(3).retry;
    expect(retry).toEqual({ attempt: 3 });
    expect(retry && 'maxAttempts' in retry).toBe(false);
  });

  it('returns the same state object for a clear with nothing to clear and for an identical status', () => {
    const idle = createChatThreadState('chat-1');
    expect(reduceChatThreadState(idle, { type: 'retry.cleared' })).toBe(idle);
    const state = retrying(2, 5);
    expect(reduceChatThreadState(state, { type: 'retry.status', attempt: 2, maxAttempts: 5 })).toBe(state);
  });

  it('clears on retry.cleared', () => {
    expect(reduceChatThreadState(retrying(2, 5), { type: 'retry.cleared' }).retry).toBeNull();
  });

  it.each<[string, ChatStateEvent]>([
    ['the turn stops', { type: 'run.stopped' }],
    ['the turn fails', { type: 'run.failed', error: new Error('x') }],
    ['the user stops the turn', { type: 'run.cancelling' }],
    ['the transcript is cleared', { type: 'transcript.cleared' }],
  ])('clears when %s', (_label, event) => {
    expect(reduceChatThreadState(retrying(2, 5), event).retry).toBeNull();
  });

  it('clears on a new turn but keeps the status across a repeated start of the same run', () => {
    expect(reduceChatThreadState(retrying(2, 5), { type: 'run.started' }).retry).toEqual({
      attempt: 2,
      maxAttempts: 5,
    });
    const idle = apply([{ type: 'retry.status', attempt: 1 }]);
    expect(reduceChatThreadState(idle, { type: 'run.started' }).retry).toBeNull();
  });
});

const upsert = (kind: 'agent_message' | 'agent_thought', content?: unknown, meta?: unknown) =>
  ({ sessionUpdate: kind, messageId: 'm1', ...(content !== undefined && { content }), _meta: meta }) as SessionUpdate;
const text = { type: 'text', text: 'hi' };

describe('clearsRetryStatus', () => {
  it('clears on any chunk and on tool progress', () => {
    const chunk = { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: text } as SessionUpdate;
    const thought = { sessionUpdate: 'agent_thought_chunk', messageId: 'm1', content: text } as SessionUpdate;
    const tool = { sessionUpdate: 'tool_call_update', toolCallId: 't1' } as SessionUpdate;
    const toolChunk = { sessionUpdate: 'tool_call_content_chunk', toolCallId: 't1' } as SessionUpdate;
    for (const update of [chunk, thought, tool, toolChunk]) expect(clearsRetryStatus(update)).toBe(true);
  });

  it('clears on an upsert with non-empty content, marked or not', () => {
    expect(clearsRetryStatus(upsert('agent_message', [text]))).toBe(true);
    expect(clearsRetryStatus(upsert('agent_thought', [text]))).toBe(true);
    const marked = { '_mainframe.dev': { retry: { attempt: 2 } } };
    expect(clearsRetryStatus(upsert('agent_message', [text], marked))).toBe(true);
  });

  it('keeps the status on an upsert with empty, null or omitted content, even when it carries a marker', () => {
    const marked = { '_mainframe.dev': { retry: { attempt: 2 } } };
    expect(clearsRetryStatus(upsert('agent_message', []))).toBe(false);
    expect(clearsRetryStatus(upsert('agent_message', null))).toBe(false);
    expect(clearsRetryStatus(upsert('agent_message'))).toBe(false);
    expect(clearsRetryStatus(upsert('agent_thought', [], marked))).toBe(false);
    expect(clearsRetryStatus(upsert('agent_message', undefined, marked))).toBe(false);
  });

  it('clears on an idle state_update only', () => {
    expect(clearsRetryStatus({ sessionUpdate: 'state_update', state: 'idle' } as SessionUpdate)).toBe(true);
    expect(clearsRetryStatus({ sessionUpdate: 'state_update', state: 'running' } as SessionUpdate)).toBe(false);
    expect(clearsRetryStatus({ sessionUpdate: 'state_update', state: 'requires_action' } as SessionUpdate)).toBe(false);
  });

  it('never clears on user messages or usage', () => {
    const userUpsert = { sessionUpdate: 'user_message', messageId: 'u', content: [text] } as SessionUpdate;
    expect(clearsRetryStatus(userUpsert)).toBe(false);
    expect(
      clearsRetryStatus({ sessionUpdate: 'user_message_chunk', messageId: 'u', content: text } as SessionUpdate),
    ).toBe(false);
    expect(clearsRetryStatus({ sessionUpdate: 'usage_update', used: 1, size: 2 } as SessionUpdate)).toBe(false);
  });
});
