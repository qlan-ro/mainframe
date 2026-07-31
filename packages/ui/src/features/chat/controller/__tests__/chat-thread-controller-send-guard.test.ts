/**
 * Behavior tests for the controller-level missing-directory send guard.
 *
 * The UI may hide the composer, but non-composer send paths still reach the
 * controller. When the chat's effective working directory is gone, send and retry
 * must stop before any optimistic state or daemon frame is produced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppendMessage } from '@assistant-ui/react';
import type { Chat, ClientEvent, DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), permission: vi.fn() },
}));

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn(),
}));

vi.mock('../../../../lib/api/chats', () => ({
  getChatMessages: vi.fn().mockResolvedValue({ messages: [], transcriptMissing: false }),
  getChat: vi.fn().mockResolvedValue({ id: 'chat-abc', directoryMissing: false }),
  getPendingPermission: vi.fn().mockResolvedValue(null),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
  trustWorkspace: vi.fn().mockResolvedValue(undefined),
}));

import { mfToast } from '@/lib/toast';
import { uploadAttachments } from '../../../../lib/api/attachments';
import { ChatThreadController } from '../chat-thread-controller';

interface FakeWs {
  sentEvents: ClientEvent[];
  fakeClient: DaemonWsClient;
  pushEvent: (event: DaemonEvent) => void;
}

function makeFakeWs(): FakeWs {
  const sentEvents: ClientEvent[] = [];
  let capturedHandler: ((event: DaemonEvent) => void) | null = null;
  const fakeClient: DaemonWsClient = {
    get connected() {
      return true;
    },
    send(event: ClientEvent) {
      sentEvents.push(event);
    },
    onEvent(handler: (event: DaemonEvent) => void) {
      capturedHandler = handler;
      return () => {
        capturedHandler = null;
      };
    },
    subscribe: () => {},
    unsubscribe: () => {},
    subscribeConnection: () => () => {},
    setPort: () => {},
    connect: () => {},
    disconnect: () => {},
  } as unknown as DaemonWsClient;
  return {
    sentEvents,
    fakeClient,
    pushEvent(event: DaemonEvent) {
      if (capturedHandler == null) throw new Error('onEvent handler not captured');
      capturedHandler(event);
    },
  };
}

function makeMsg(text: string): AppendMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    attachments: [],
    parentId: null,
  } as unknown as AppendMessage;
}

function makeAttachmentMsg(text: string): AppendMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    attachments: [
      {
        id: 'att-1',
        type: 'image',
        name: 'screen.png',
        contentType: 'image/png',
        status: { type: 'complete' },
        content: [{ type: 'image', image: 'data:image/png;base64,aGVsbG8=' }],
      },
    ],
    parentId: null,
  } as unknown as AppendMessage;
}

function chatConfig(overrides: Partial<Chat>): Chat {
  return { id: 'chat-abc', directoryMissing: false, missingDirectoryPath: undefined, ...overrides } as unknown as Chat;
}

function seedChat(ctrl: ChatThreadController, pushEvent: FakeWs['pushEvent'], chat: Chat): void {
  ctrl.subscribeLive();
  pushEvent({ type: 'subscribe:ack', chatId: CHAT_ID } as unknown as DaemonEvent);
  pushEvent({ type: 'chat.updated', chat } as unknown as DaemonEvent);
}

const CHAT_ID = 'chat-abc';
const PORT = 9999;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChatThreadController — missing directory send guard', () => {
  it('refuses sendMessage before sending, queuing, or starting a run', async () => {
    const { sentEvents, fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    seedChat(ctrl, pushEvent, chatConfig({ directoryMissing: true, missingDirectoryPath: '/gone/proj' }));

    await ctrl.sendMessage(makeMsg('hello'));

    expect(sentEvents.filter((e) => e.type === 'message.send')).toHaveLength(0);
    expect(Object.values(ctrl.getState().pendingUserMessages)).toEqual([]);
    expect(ctrl.getState().runState).toEqual({ type: 'idle' });
    expect(mfToast.error).toHaveBeenCalledOnce();
    expect(vi.mocked(mfToast.error).mock.calls[0]![1]).toEqual({ description: '/gone/proj' });
  });

  it('refuses retryMessage without changing the failed pending', async () => {
    const { sentEvents, fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    vi.mocked(uploadAttachments).mockRejectedValueOnce(new Error('upload failed'));
    await ctrl.sendMessage(makeAttachmentMsg('retry me')).catch(() => {});
    const failed = Object.values(ctrl.getState().pendingUserMessages)[0]!;
    seedChat(ctrl, pushEvent, chatConfig({ directoryMissing: true, missingDirectoryPath: '/gone/proj' }));

    await ctrl.retryMessage(failed.clientId);

    expect(sentEvents.filter((e) => e.type === 'message.send')).toHaveLength(0);
    expect(ctrl.getState().pendingUserMessages[failed.clientId]).toMatchObject({
      clientId: failed.clientId,
      text: 'retry me',
      status: 'failed',
    });
    expect(mfToast.error).toHaveBeenCalledOnce();
    expect(vi.mocked(mfToast.error).mock.calls[0]![1]).toEqual({ description: '/gone/proj' });
  });

  it('still sends and retries when the directory is available', async () => {
    const { sentEvents, fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    seedChat(ctrl, pushEvent, chatConfig({ directoryMissing: false }));

    await ctrl.sendMessage(makeMsg('hello'));

    expect(sentEvents.filter((e) => e.type === 'message.send')).toEqual([
      { type: 'message.send', chatId: CHAT_ID, content: 'hello' },
    ]);

    vi.mocked(uploadAttachments).mockRejectedValueOnce(new Error('upload failed'));
    await ctrl.sendMessage(makeAttachmentMsg('retry me')).catch(() => {});
    const failed = Object.values(ctrl.getState().pendingUserMessages).find((pending) => pending.text === 'retry me')!;
    sentEvents.length = 0;

    await ctrl.retryMessage(failed.clientId);

    expect(sentEvents.filter((e) => e.type === 'message.send')).toEqual([
      { type: 'message.send', chatId: CHAT_ID, content: 'retry me' },
    ]);
  });
});
