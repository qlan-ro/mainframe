/**
 * `useChatExtrasState` — the snapshot `extras` is built from must survive a
 * transcript-only update (every streamed chunk) unchanged, and must move the
 * moment any other field does.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createChatThreadState, reduceChatThreadState, type ChatThreadState } from '../../controller/chat-thread-state';
import { useChatExtrasState } from '../chat-extras';

describe('useChatExtrasState', () => {
  it('keeps the held snapshot when only messages changed', () => {
    const initial = createChatThreadState('c1');
    const { result, rerender } = renderHook(({ state }) => useChatExtrasState(state), {
      initialProps: { state: initial },
    });
    expect(result.current).toBe(initial);

    const streamed = reduceChatThreadState(initial, {
      type: 'transcript.updated',
      messages: [{ id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] }],
    });
    rerender({ state: streamed });
    expect(result.current).toBe(initial);
  });

  it('adopts the new snapshot when any other field changes', () => {
    const initial = createChatThreadState('c1');
    const { result, rerender } = renderHook(({ state }: { state: ChatThreadState }) => useChatExtrasState(state), {
      initialProps: { state: initial },
    });

    const running = reduceChatThreadState(initial, { type: 'run.started' });
    rerender({ state: running });
    expect(result.current).toBe(running);

    const usage = reduceChatThreadState(running, {
      type: 'context.usage',
      percentage: 50,
      totalTokens: 5,
      maxTokens: 10,
    });
    rerender({ state: usage });
    expect(result.current).toBe(usage);
  });
});
