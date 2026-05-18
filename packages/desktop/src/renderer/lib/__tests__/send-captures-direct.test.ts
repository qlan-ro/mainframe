import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSendMessage, mockResumeChat, mockCreateChat } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
  mockResumeChat: vi.fn(),
  mockCreateChat: vi.fn(),
}));

vi.mock('../client.js', () => ({
  daemonClient: {
    sendMessage: mockSendMessage,
    resumeChat: mockResumeChat,
    createChat: mockCreateChat,
  },
}));

const { mockUploadAttachments } = vi.hoisted(() => ({
  mockUploadAttachments: vi.fn(),
}));

vi.mock('../api/attachments-api.js', () => ({
  uploadAttachments: mockUploadAttachments,
}));

const { mockGetState, mockSubscribe } = vi.hoisted(() => ({
  mockGetState: vi.fn(),
  mockSubscribe: vi.fn(),
}));

vi.mock('../../store/chats.js', () => ({
  useChatsStore: {
    getState: mockGetState,
    subscribe: mockSubscribe,
  },
}));

vi.mock('../../hooks/useActiveProjectId.js', () => ({
  getActiveProjectId: vi.fn(() => null),
}));

vi.mock('../adapters.js', () => ({
  getDefaultModelForAdapter: vi.fn(() => 'claude-3-5-sonnet'),
}));

import { sendCapturesDirect } from '../send-captures-direct.js';

const img = 'data:image/png;base64,QUJD';

const makeCapture = (id: string, type: 'element' | 'screenshot' = 'element') => ({
  id,
  type,
  imageDataUrl: img,
  selector: type === 'element' ? `#${id}` : undefined,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUploadAttachments.mockResolvedValue([
    { id: 'att-1', name: 'element1.png', mediaType: 'image/png', sizeBytes: 3, kind: 'image' as const },
  ]);
});

describe('sendCapturesDirect', () => {
  it('uploads attachments and sends message when chat is active and running', async () => {
    mockGetState.mockReturnValue({
      activeChatId: 'chat-42',
      processes: new Map([['chat-42', { status: 'running' }]]),
    });

    await sendCapturesDirect([makeCapture('a')], undefined);

    expect(mockUploadAttachments).toHaveBeenCalledOnce();
    const [calledChatId, calledAttachments] = mockUploadAttachments.mock.calls[0] as [string, unknown[]];
    expect(calledChatId).toBe('chat-42');
    expect(calledAttachments).toHaveLength(1);

    expect(mockResumeChat).not.toHaveBeenCalled();

    expect(mockSendMessage).toHaveBeenCalledOnce();
    const [sentChatId, sentContent, sentIds] = mockSendMessage.mock.calls[0] as [string, string, string[]];
    expect(sentChatId).toBe('chat-42');
    expect(sentContent).toContain('Preview captures');
    expect(sentIds).toEqual(['att-1']);
  });

  it('calls resumeChat before sending when process is stopped', async () => {
    mockGetState.mockReturnValue({
      activeChatId: 'chat-99',
      processes: new Map([['chat-99', { status: 'stopped' }]]),
    });

    await sendCapturesDirect([makeCapture('b')], 'chat-99');

    expect(mockResumeChat).toHaveBeenCalledWith('chat-99');
    expect(mockSendMessage).toHaveBeenCalledOnce();
  });

  it('does nothing when captures array is empty', async () => {
    await sendCapturesDirect([], undefined);

    expect(mockUploadAttachments).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
