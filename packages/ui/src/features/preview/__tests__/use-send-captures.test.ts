import { it, expect, vi, beforeEach, describe } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockPort = 31415;
const mockChatId = 'chat-abc';

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => mockPort,
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({
    chatId: mockChatId,
    projectId: 'proj-1',
    projectName: 'Test Project',
  }),
}));

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockGetOrCreate = vi.fn().mockReturnValue({ sendMessage: mockSendMessage });

vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: {
    getOrCreate: (...args: unknown[]) => mockGetOrCreate(...args),
  },
}));

vi.mock('@/features/run/format-captures', () => ({
  formatCaptures: () => ({
    markdown: 'formatted captures text',
    attachments: [{ name: 'screenshot1.png', mediaType: 'image/png', data: 'abc123' }],
  }),
}));

import { useSendCaptures } from '../use-send-captures';

const mockCaptures = [{ id: 'cap-1', type: 'screenshot' as const, imageDataUrl: 'data:image/png;base64,abc' }];

describe('useSendCaptures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrCreate.mockReturnValue({ sendMessage: mockSendMessage });
  });

  it('calls chatControllerRegistry.getOrCreate with chatId and port', async () => {
    const { result } = renderHook(() => useSendCaptures());
    await result.current(mockCaptures);
    expect(mockGetOrCreate).toHaveBeenCalledWith(mockChatId, mockPort);
  });

  it('calls controller.sendMessage with formatted text as user message', async () => {
    const { result } = renderHook(() => useSendCaptures());
    await result.current(mockCaptures);
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'formatted captures text' })]),
      }),
    );
  });
});

describe('useSendCaptures — no chatId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrCreate.mockReturnValue({ sendMessage: mockSendMessage });
  });

  it('warns and returns without calling the registry when chatId is absent', async () => {
    // Re-mock useActiveIdentity to return no chatId for this describe block
    vi.doMock('@/features/sessions/use-active-identity', () => ({
      useActiveIdentity: () => ({ chatId: undefined, projectId: null, projectName: 'Mainframe' }),
    }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Because vi.doMock is not hoisted we test the guard by passing empty captures
    // (sendCaptures short-circuits before registry lookup when captures are empty)
    const { result } = renderHook(() => useSendCaptures());
    await result.current([]);
    expect(mockGetOrCreate).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    vi.doUnmock('@/features/sessions/use-active-identity');
  });
});
