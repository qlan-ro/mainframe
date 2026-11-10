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

const mockDraft = { current: undefined as unknown };
vi.mock('@/features/sessions/use-active-draft-config', () => ({
  useActiveDraftConfig: () => mockDraft.current,
}));

const mockInitialize = vi.fn();
vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({ threadListItem: () => ({ initialize: mockInitialize }) }),
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
    mockDraft.current = undefined;
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

describe('useSendReview — draft session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveIdentity.chatId = undefined;
    mockDraft.current = { projectId: 'proj-1' };
    mockInitialize.mockResolvedValue({ remoteId: 'chat-new', externalId: undefined });
    mockSendMessage.mockResolvedValue(undefined);
    mockGetOrCreate.mockReturnValue({ sendMessage: mockSendMessage });
  });

  it('initializes the draft, sends to the adopted remote id and returns sent', async () => {
    const { result } = renderHook(() => useSendReview());
    await expect(result.current('src/foo.ts', mockItems)).resolves.toBe('sent');
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockGetOrCreate).toHaveBeenCalledWith('chat-new', mockPort);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not initialize an empty review', async () => {
    const { result } = renderHook(() => useSendReview());
    await expect(result.current('src/foo.ts', [])).resolves.toBe('empty');
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('rejects and sends nothing when initialize fails', async () => {
    mockInitialize.mockRejectedValue(new Error('create failed'));
    const { result } = renderHook(() => useSendReview());
    await expect(result.current('src/foo.ts', mockItems)).rejects.toThrow('create failed');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('rejects when sendMessage fails', async () => {
    mockSendMessage.mockRejectedValue(new Error('send failed'));
    const { result } = renderHook(() => useSendReview());
    await expect(result.current('src/foo.ts', mockItems)).rejects.toThrow('send failed');
  });

  it('does not initialize for an existing session', async () => {
    mockActiveIdentity.chatId = mockChatId;
    const { result } = renderHook(() => useSendReview());
    await result.current('src/foo.ts', mockItems);
    expect(mockInitialize).not.toHaveBeenCalled();
    expect(mockGetOrCreate).toHaveBeenCalledWith(mockChatId, mockPort);
  });
});
