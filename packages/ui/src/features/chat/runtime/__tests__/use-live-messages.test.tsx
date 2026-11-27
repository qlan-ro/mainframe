// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { createChatThreadState } from '../../controller/chat-thread-state';

const f = vi.hoisted(() => ({
  shown: [{ id: 'window-1' }] as Array<{ id: string }>,
  window: false,
  controller: undefined as undefined | { getState: () => object; subscribeState: (l: () => void) => () => void },
}));
vi.mock('@assistant-ui/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@assistant-ui/react')>()),
  useAuiState: (select: (state: unknown) => unknown) => select({ thread: { messages: f.shown } }),
}));
vi.mock('../chat-extras', () => ({
  useChatExtras: () => ({ state: { chatId: 'chat' } }),
}));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { get: () => f.controller },
}));
import { useLiveMessages } from '../use-live-messages';

const message = (id: string): ThreadMessageLike => ({ id, role: 'assistant', content: [{ type: 'text', text: id }] });

beforeEach(() => {
  f.shown = [{ id: 'window-1' }];
  f.window = false;
  const messages = [message('live-1'), message('live-2')];
  const windowMessages = [message('window-1')];
  f.controller = {
    getState: () => ({
      ...createChatThreadState('chat'),
      messages,
      windowMessages: f.window ? windowMessages : null,
    }),
    subscribeState: () => () => undefined,
  };
});

const ids = (messages: readonly { id: string }[]) => messages.map((m) => m.id);

describe('the chat’s live transcript, for Activity and the gate queue', () => {
  it('is what the selector makes of the thread’s own messages at the live tail', () => {
    const { result } = renderHook(() => useLiveMessages(ids));
    expect(result.current).toEqual(['window-1']);
  });

  it('is what it makes of the live window while the transcript shows a window around a jump target', () => {
    f.window = true;
    const { result } = renderHook(() => useLiveMessages(ids));
    expect(result.current).toEqual(['live-1', 'live-2']);
  });

  it('hands the selector messages shaped as the thread’s own', () => {
    f.window = true;
    const { result } = renderHook(() => useLiveMessages((messages) => messages.map((m) => m.metadata)));
    expect(result.current[0]).toMatchObject({ custom: expect.anything() });
  });

  it('follows the controller’s own state, not the history state that lands a render later', () => {
    f.window = true;
    const { result, rerender } = renderHook(() => useLiveMessages((messages) => messages.length));
    expect(result.current).toBe(2);
    f.window = false;
    rerender();
    expect(result.current).toBe(1);
  });
});
