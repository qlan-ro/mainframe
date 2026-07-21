// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { LineCommentInput } from '@/lib/editor/format-line-comment';

const mockPort = 31415;
const mockChatId = 'chat-abc';

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => mockPort,
}));

// Mutable return so individual tests can override chatId.
const mockActiveIdentity = {
  chatId: mockChatId as string | undefined,
  projectId: 'proj-1',
  projectName: 'Test Project',
};

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => mockActiveIdentity,
}));

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockGetOrCreate = vi.fn().mockReturnValue({ sendMessage: mockSendMessage });

vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: {
    getOrCreate: (...args: unknown[]) => mockGetOrCreate(...args),
  },
}));

vi.mock('@/lib/editor/format-line-comment', () => ({
  formatReview: (_filePath: string, _items: LineCommentInput[]) => 'formatted review text',
}));

import { useSendReview } from '../use-send-review';

const mockItems: LineCommentInput[] = [
  { startLine: 1, endLine: 1, lineContent: 'const x = 1;', comment: 'Use let here' },
];

describe('useSendReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveIdentity.chatId = mockChatId;
    mockGetOrCreate.mockReturnValue({ sendMessage: mockSendMessage });
  });

  it('calls chatControllerRegistry.getOrCreate with chatId and port', async () => {
    const { result } = renderHook(() => useSendReview());
    await result.current('src/foo.ts', mockItems);
    expect(mockGetOrCreate).toHaveBeenCalledWith(mockChatId, mockPort);
  });

  it('calls controller.sendMessage with formatReview output as user text message', async () => {
    const { result } = renderHook(() => useSendReview());
    await result.current('src/foo.ts', mockItems);
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'formatted review text' })]),
      }),
    );
  });

  it('sends no attachments', async () => {
    const { result } = renderHook(() => useSendReview());
    await result.current('src/foo.ts', mockItems);
    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ attachments: [] }));
  });
});

describe('useSendReview — no chatId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveIdentity.chatId = undefined;
    mockGetOrCreate.mockReturnValue({ sendMessage: mockSendMessage });
  });

  it('does not call registry or sendMessage when chatId is absent', async () => {
    // chatId is undefined; pass NON-empty items to hit the !chatId guard, not the empty-items guard.
    const { result } = renderHook(() => useSendReview());
    await result.current('src/foo.ts', mockItems);
    expect(mockGetOrCreate).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe('useSendReview — empty items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveIdentity.chatId = mockChatId;
    mockGetOrCreate.mockReturnValue({ sendMessage: mockSendMessage });
  });

  it('does not call sendMessage when items array is empty', async () => {
    const { result } = renderHook(() => useSendReview());
    await result.current('src/foo.ts', []);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
