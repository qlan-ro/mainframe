import { it, expect, vi, beforeEach, describe } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockPort = 31415;
const mockGetActiveThread = vi.fn();

vi.mock('@assistant-ui/react', () => ({
  useAssistantRuntime: () => ({
    threads: { getActiveThread: mockGetActiveThread },
  }),
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => mockPort,
}));

const mockSendCaptures = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/run/send-captures', () => ({
  sendCaptures: (...a: unknown[]) => mockSendCaptures(...a),
}));

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: {
    getOrCreate: vi.fn().mockReturnValue({ sendMessage: mockSendMessage, daemonId: 'chat-123' }),
  },
}));

vi.mock('@/lib/api/attachments', () => ({
  uploadAttachments: vi.fn().mockResolvedValue([]),
}));

import { useSendCaptures } from '../use-send-captures';

const mockCaptures = [
  { id: 'cap-1', type: 'screenshot' as const, imageDataUrl: 'data:image/png;base64,abc' },
];

describe('useSendCaptures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('warns and returns if no active thread remoteId', async () => {
    mockGetActiveThread.mockReturnValue(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useSendCaptures());
    await result.current(mockCaptures);
    expect(mockSendCaptures).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('calls sendCaptures with correct port and chatId', async () => {
    mockGetActiveThread.mockReturnValue({ remoteId: 'chat-abc' });
    const { result } = renderHook(() => useSendCaptures());
    await result.current(mockCaptures);
    expect(mockSendCaptures).toHaveBeenCalledWith(
      mockCaptures,
      expect.objectContaining({ port: mockPort, chatId: 'chat-abc' }),
    );
  });
});
