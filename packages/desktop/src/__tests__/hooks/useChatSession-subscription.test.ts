import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock the daemon client module
const mockResumeChat = vi.fn();
const mockUnsubscribe = vi.fn();
const mockSubscribeConnection = vi.fn(() => vi.fn());

vi.mock('../../renderer/lib/client.js', () => ({
  daemonClient: {
    resumeChat: mockResumeChat,
    unsubscribe: mockUnsubscribe,
    subscribeConnection: mockSubscribeConnection,
    connected: true,
  },
}));

vi.mock('../../renderer/lib/api.js', () => ({
  getChatMessages: vi.fn().mockResolvedValue([]),
  getPendingPermission: vi.fn().mockResolvedValue(null),
  uploadAttachments: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../renderer/store/chats.js', () => {
  const state = {
    messages: new Map(),
    pendingPermissions: new Map(),
    setMessages: vi.fn(),
    addPendingPermission: vi.fn(),
  };
  return {
    useChatsStore: Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), {
      getState: () => state,
    }),
  };
});

vi.mock('../../renderer/lib/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { useChatSession } = await import('../../renderer/hooks/useChatSession.js');

describe('useChatSession subscription lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls resumeChat on mount', () => {
    renderHook(() => useChatSession('chat-1'));
    expect(mockResumeChat).toHaveBeenCalledWith('chat-1');
  });

  it('does NOT call unsubscribe on unmount', () => {
    const { unmount } = renderHook(() => useChatSession('chat-1'));
    unmount();
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });

  it('does NOT call unsubscribe when chatId changes', () => {
    const { rerender } = renderHook(({ chatId }) => useChatSession(chatId), {
      initialProps: { chatId: 'chat-1' as string | null },
    });
    rerender({ chatId: 'chat-2' });
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });
});
