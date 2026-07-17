/**
 * Behavior tests for useChatThreadRuntime — dormancy split + onNew create-then-send.
 *
 * Verifies:
 *   active:true    — controller.subscribeLive() called once after mount; teardown on unmount.
 *   active:false   — subscribeLive NOT called; subscribeState still fires.
 *   toggle active  — re-render with { active:true } after { active:false } opens the live sub.
 *   onNew local    — controller without a remoteId → createForLocal → setRemoteId → sendMessage.
 *   onNew remote   — controller already has a remoteId → createForLocal NOT called; sendMessage called.
 *
 * Fake controller exposes the minimal surface the hook uses:
 *   subscribeState, subscribeLive, getState, getThreadId, hasRemoteId, load, setRemoteId, sendMessage.
 *
 * getState MUST return a stable (cached) object reference — React's useSyncExternalStore
 * warns and re-renders infinitely when getSnapshot returns a new object every call.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatThreadController } from '../../controller/chat-thread-controller';
import type { AppendMessage } from '@assistant-ui/react';

// ---------------------------------------------------------------------------
// Hoist mocks
// ---------------------------------------------------------------------------

vi.mock('../../../sessions/runtime/new-thread-coordinator', () => ({
  createForLocal: vi.fn().mockResolvedValue({ remoteId: 'chat-77' }),
}));

// Capture the onNew callback from the external-store runtime options on each render.
type ExternalStoreOpts = {
  onNew?: (msg: AppendMessage) => Promise<void>;
  [key: string]: unknown;
};

const capturedOnNew: { current: ((msg: AppendMessage) => Promise<void>) | undefined } = { current: undefined };

vi.mock('@assistant-ui/react', () => {
  const fakeSentinel = Symbol('fake-aui-runtime');
  return {
    useExternalStoreRuntime: (opts: ExternalStoreOpts) => {
      capturedOnNew.current = opts.onNew;
      return fakeSentinel;
    },
    useAuiState: vi.fn(() => undefined),
  };
});

vi.mock('../../composer/attachment-adapter', () => ({
  createAttachmentAdapter: () => ({}),
}));

vi.mock('../../controller/project-messages', () => ({
  projectChatThreadRepository: () => ({ getMessages: () => [] }),
}));

vi.mock('../../gates/select-front', () => ({
  selectPermissionFront: () => undefined,
}));

import { createForLocal } from '../../../sessions/runtime/new-thread-coordinator';
import { useChatThreadRuntime as _useChatThreadRuntime } from '../use-chat-thread-runtime';
import { createChatThreadState } from '../../controller/chat-thread-state';
import type { ChatThreadState } from '../../controller/chat-thread-state';
import type { AssistantRuntime } from '@assistant-ui/react';

// Cast to the intended post-implementation signature (opts is not wired yet — this
// test is intentionally failing until Task 4.9 implementation is complete).
const useChatThreadRuntime = _useChatThreadRuntime as (
  controller: ChatThreadController,
  port: number,
  opts?: { active?: boolean },
) => AssistantRuntime;

// ---------------------------------------------------------------------------
// Fake controller factory
// ---------------------------------------------------------------------------

interface FakeData {
  subscribeStateCalls: number;
  subscribeLiveCalls: number;
  subscribeLiveTeardownCalls: number;
  setRemoteIdCalls: string[];
  sendMessageCalls: AppendMessage[];
  _hasRemoteId: boolean;
  controller: ChatThreadController;
}

function makeFakeController(chatId: string, hasRemoteId = false): FakeData {
  // Stable state snapshot — useSyncExternalStore requires getSnapshot to return
  // the same reference unless state actually changes.
  const stableState: ChatThreadState = createChatThreadState(chatId);

  const data: FakeData = {
    subscribeStateCalls: 0,
    subscribeLiveCalls: 0,
    subscribeLiveTeardownCalls: 0,
    setRemoteIdCalls: [],
    sendMessageCalls: [],
    _hasRemoteId: hasRemoteId,
    controller: null as unknown as ChatThreadController,
  };

  const teardown = vi.fn(() => {
    data.subscribeLiveTeardownCalls += 1;
  });

  const ctrl = {
    subscribeState: (_listener: () => void) => {
      data.subscribeStateCalls += 1;
      return () => {};
    },
    subscribeLive: () => {
      data.subscribeLiveCalls += 1;
      return teardown;
    },
    getState: () => stableState,
    getThreadId: () => chatId,
    hasRemoteId: () => data._hasRemoteId,
    load: vi.fn().mockResolvedValue(undefined),
    setRemoteId: (remoteId: string) => {
      data.setRemoteIdCalls.push(remoteId);
    },
    sendMessage: vi.fn((msg: AppendMessage) => {
      data.sendMessageCalls.push(msg);
      return Promise.resolve();
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    replyToPermission: vi.fn().mockResolvedValue(undefined),
    cancelQueued: vi.fn().mockResolvedValue(undefined),
    editQueued: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatThreadController;

  data.controller = ctrl;
  return data;
}

const PORT = 9999;

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnNew.current = undefined;
});

// ---------------------------------------------------------------------------
// 1. active:true opens the live sub
// ---------------------------------------------------------------------------

describe('useChatThreadRuntime — active:true opens the live sub', () => {
  it('calls controller.subscribeLive() exactly once after mount with { active:true }', () => {
    const fake = makeFakeController('chat-1');

    const { unmount } = renderHook(() => useChatThreadRuntime(fake.controller, PORT, { active: true }));

    expect(fake.subscribeLiveCalls).toBe(1);
    unmount();
  });

  it('calls the subscribeLive teardown once on unmount', () => {
    const fake = makeFakeController('chat-1');

    const { unmount } = renderHook(() => useChatThreadRuntime(fake.controller, PORT, { active: true }));

    unmount();

    expect(fake.subscribeLiveTeardownCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. active:false (or no opts) never opens the live sub
// ---------------------------------------------------------------------------

describe('useChatThreadRuntime — active:false never opens the live sub', () => {
  it('does NOT call subscribeLive when { active:false }', () => {
    const fake = makeFakeController('chat-1');

    const { unmount } = renderHook(() => useChatThreadRuntime(fake.controller, PORT, { active: false }));

    expect(fake.subscribeLiveCalls).toBe(0);
    unmount();
  });

  it('does NOT call subscribeLive when no opts are provided (default dormant)', () => {
    const fake = makeFakeController('chat-1');

    const { unmount } = renderHook(() => useChatThreadRuntime(fake.controller, PORT));

    expect(fake.subscribeLiveCalls).toBe(0);
    unmount();
  });

  it('still calls subscribeState so the UI re-renders from in-memory state when active:false', () => {
    const fake = makeFakeController('chat-1');

    const { unmount } = renderHook(() => useChatThreadRuntime(fake.controller, PORT, { active: false }));

    expect(fake.subscribeStateCalls).toBeGreaterThanOrEqual(1);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// 3. Toggling active false → true opens the live sub
// ---------------------------------------------------------------------------

describe('useChatThreadRuntime — toggling active false→true opens the live sub', () => {
  it('calls subscribeLive once after re-render with { active:true } from { active:false }', () => {
    const fake = makeFakeController('chat-1');

    const { rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) => useChatThreadRuntime(fake.controller, PORT, { active }),
      { initialProps: { active: false } },
    );

    expect(fake.subscribeLiveCalls).toBe(0);

    act(() => {
      rerender({ active: true });
    });

    expect(fake.subscribeLiveCalls).toBe(1);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// 4. onNew on a local controller: createForLocal → setRemoteId → sendMessage
// ---------------------------------------------------------------------------

describe('useChatThreadRuntime — onNew on a local controller (no remoteId)', () => {
  it('runs createForLocal before setRemoteId before sendMessage (order constraint), passing the threadId/port and original message through', async () => {
    const order: string[] = [];

    vi.mocked(createForLocal).mockImplementationOnce(async (_localId: string, _port: number) => {
      order.push('createForLocal');
      return { remoteId: 'chat-77' };
    });

    const chatId = '__LOCALID_order';
    const stableState: ChatThreadState = createChatThreadState(chatId);

    const setRemoteIdCalls: string[] = [];
    const sendMessageCalls: AppendMessage[] = [];

    const ctrl = {
      subscribeState: (_l: () => void) => () => {},
      subscribeLive: () => () => {},
      getState: () => stableState,
      getThreadId: () => chatId,
      hasRemoteId: () => false,
      load: vi.fn().mockResolvedValue(undefined),
      setRemoteId: (id: string) => {
        order.push('setRemoteId');
        setRemoteIdCalls.push(id);
      },
      sendMessage: vi.fn((msg: AppendMessage) => {
        order.push('sendMessage');
        sendMessageCalls.push(msg);
        return Promise.resolve();
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
      replyToPermission: vi.fn().mockResolvedValue(undefined),
      cancelQueued: vi.fn().mockResolvedValue(undefined),
      editQueued: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatThreadController;

    const { unmount } = renderHook(() => useChatThreadRuntime(ctrl, PORT, { active: false }));

    const msg = {
      role: 'user',
      content: [{ type: 'text', text: 'ordered' }],
      attachments: [],
      parentId: null,
    } as unknown as AppendMessage;

    await act(async () => {
      await capturedOnNew.current?.(msg);
    });

    expect(order).toEqual(['createForLocal', 'setRemoteId', 'sendMessage']);
    expect(vi.mocked(createForLocal)).toHaveBeenCalledWith(chatId, PORT);
    expect(setRemoteIdCalls).toEqual(['chat-77']);
    expect(sendMessageCalls).toEqual([msg]);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// 5. onNew on a controller that already has a remoteId: just sends
// ---------------------------------------------------------------------------

describe('useChatThreadRuntime — onNew on a controller with a remoteId (existing chat)', () => {
  it('does NOT call createForLocal when hasRemoteId is true', async () => {
    const fake = makeFakeController('chat-existing', true);

    const { unmount } = renderHook(() => useChatThreadRuntime(fake.controller, PORT, { active: false }));

    const msg = {
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      attachments: [],
      parentId: null,
    } as unknown as AppendMessage;

    await act(async () => {
      await capturedOnNew.current?.(msg);
    });

    expect(vi.mocked(createForLocal)).not.toHaveBeenCalled();
    unmount();
  });

  it('calls sendMessage exactly once when hasRemoteId is true', async () => {
    const fake = makeFakeController('chat-existing', true);

    const { unmount } = renderHook(() => useChatThreadRuntime(fake.controller, PORT, { active: false }));

    const msg = {
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      attachments: [],
      parentId: null,
    } as unknown as AppendMessage;

    await act(async () => {
      await capturedOnNew.current?.(msg);
    });

    expect(fake.sendMessageCalls).toHaveLength(1);
    unmount();
  });
});
