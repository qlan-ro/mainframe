/**
 * Behavior tests for ChatThreadController.retryMessage.
 *
 * A failed optimistic send leaves a `status: 'failed'` pending in state (the
 * "Failed to send" indicator). retryMessage re-emits the message.send frame for
 * that pending's text, flips it back to 'pending', clears the error, and returns
 * the run to running. Attachments are NOT re-uploaded (text-only retry).
 *
 * Harness mirrors chat-thread-controller-send.test.ts (fake ws + mocked REST).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppendMessage } from '@assistant-ui/react';
import type { ClientEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn(),
}));

vi.mock('../../../../lib/api/chats', () => ({
  getChatMessages: vi.fn().mockResolvedValue([]),
  getChat: vi.fn().mockResolvedValue(null),
  getPendingPermission: vi.fn().mockResolvedValue(null),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));

import { uploadAttachments } from '../../../../lib/api/attachments';
import { ChatThreadController } from '../chat-thread-controller';

function makeFakeWs(): { sentEvents: ClientEvent[]; fakeClient: DaemonWsClient } {
  const sentEvents: ClientEvent[] = [];
  const fakeClient: DaemonWsClient = {
    get connected() {
      return false;
    },
    send(event: ClientEvent) {
      sentEvents.push(event);
    },
    onEvent: () => () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    subscribeConnection: () => () => {},
    setPort: () => {},
    connect: () => {},
    disconnect: () => {},
  } as unknown as DaemonWsClient;
  return { sentEvents, fakeClient };
}

function makeMsg(text: string, attachments?: NonNullable<AppendMessage['attachments']>): AppendMessage {
  return {
    role: 'user',
    content: text ? [{ type: 'text', text }] : [],
    attachments: attachments ?? [],
    parentId: null,
  } as unknown as AppendMessage;
}

function makeCompleteAttachment(name: string): NonNullable<AppendMessage['attachments']>[number] {
  return {
    id: 'att-1',
    type: 'image',
    name,
    contentType: 'image/png',
    status: { type: 'complete' },
    content: [{ type: 'image', image: 'data:image/png;base64,aGVsbG8=' }],
  };
}

const CHAT_ID = 'chat-abc';
const PORT = 9999;

beforeEach(() => {
  vi.clearAllMocks();
});

/** Send a message whose upload rejects, leaving a failed pending; return its clientId. */
async function seedFailedPending(ctrl: ChatThreadController, text: string): Promise<string> {
  vi.mocked(uploadAttachments).mockRejectedValueOnce(new Error('boom'));
  await ctrl.sendMessage(makeMsg(text, [makeCompleteAttachment('f.png')])).catch(() => {});
  const failed = Object.values(ctrl.getState().pendingUserMessages)[0];
  expect(failed?.status).toBe('failed');
  return failed!.clientId;
}

describe('ChatThreadController.retryMessage', () => {
  it('re-emits a message.send frame with the failed message text', async () => {
    const { sentEvents, fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    const clientId = await seedFailedPending(ctrl, 'retry me');

    await ctrl.retryMessage(clientId);

    const sends = sentEvents.filter((e) => e.type === 'message.send');
    expect(sends).toHaveLength(1);
    expect(sends[0]).toEqual({ type: 'message.send', chatId: CHAT_ID, content: 'retry me' });
  });

  it('flips the pending back to pending, clears the error, and resumes running', async () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    const clientId = await seedFailedPending(ctrl, 'retry me');

    await ctrl.retryMessage(clientId);

    const after = ctrl.getState().pendingUserMessages[clientId];
    expect(after?.status).toBe('pending');
    expect(after?.error).toBeUndefined();
    expect(ctrl.getState().runState.type).toBe('running');
  });

  it('is a no-op when the clientId is unknown', async () => {
    const { sentEvents, fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    await ctrl.retryMessage('does-not-exist');

    expect(sentEvents.filter((e) => e.type === 'message.send')).toHaveLength(0);
  });
});
