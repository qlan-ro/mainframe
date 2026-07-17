// @vitest-environment jsdom
import { it, expect, vi, beforeEach, describe } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockPort = 31415;
const mockChatId = 'chat-abc';

// Mutable holder so individual tests can flip chatId to undefined — a plain
// top-level vi.mock is hoisted (unlike vi.doMock), so this is the only way
// to vary the mocked identity across tests in the same file.
const identityHolder: { chatId: string | undefined; projectId: string | null; projectName: string } = {
  chatId: mockChatId,
  projectId: 'proj-1',
  projectName: 'Test Project',
};

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => mockPort,
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => identityHolder,
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
    identityHolder.chatId = mockChatId;
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
    identityHolder.chatId = undefined;
    mockGetOrCreate.mockReturnValue({ sendMessage: mockSendMessage });
  });

  it('warns and returns without calling the registry, even with non-empty captures', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Non-empty captures prove the chatId guard is checked BEFORE the
    // captures.length guard — the old version of this test passed empty
    // captures, which short-circuits on a different branch and never
    // actually exercises the no-chatId path.
    const { result } = renderHook(() => useSendCaptures());
    await result.current(mockCaptures);

    expect(warnSpy).toHaveBeenCalledWith('[preview] no active chatId, skipping send');
    expect(mockGetOrCreate).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
