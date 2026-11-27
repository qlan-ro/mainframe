// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { createChatThreadState } from '../../controller/chat-thread-state';

const f = vi.hoisted(() => ({
  shown: [{ id: 'window-1' }] as Array<{ id: string }>,
  detached: false,
  controller: undefined as undefined | { getState: () => object; subscribeState: (l: () => void) => () => void },
}));
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (state: unknown) => unknown) => select({ thread: { messages: f.shown } }),
}));
vi.mock('../chat-extras', () => ({
  useChatExtras: () => ({ state: { chatId: 'chat', historyWindow: { detached: f.detached ? {} : undefined } } }),
}));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { get: () => f.controller },
}));
import { useLiveMessages } from '../use-live-messages';

const message = (id: string): ThreadMessageLike => ({ id, role: 'assistant', content: [{ type: 'text', text: id }] });

beforeEach(() => {
  f.shown = [{ id: 'window-1' }];
  f.detached = false;
  const state = {
    ...createChatThreadState('chat'),
    messages: [message('live-1'), message('live-2')],
    windowMessages: [message('window-1')],
  };
  f.controller = { getState: () => state, subscribeState: () => () => undefined };
});

describe('the chat’s live transcript, for Activity and the gate queue', () => {
  it('is the thread’s own messages at the live tail', () => {
    const { result } = renderHook(() => useLiveMessages());
    expect(result.current).toBe(f.shown);
  });

  it('is the live window while the reader is in a window around a jump target', () => {
    f.detached = true;
    const { result } = renderHook(() => useLiveMessages());
    expect(result.current.map((m) => m.id)).toEqual(['live-1', 'live-2']);
  });
});
