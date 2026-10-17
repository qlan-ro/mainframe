/**
 * Local attachment previews — a just-sent turn shows its attachments from the
 * composer's bytes instead of waiting for the daemon's echo (pending) or the
 * CLI's dequeue (queued).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';

vi.mock('../../../../lib/api/attachments', () => ({ uploadAttachments: vi.fn() }));
vi.mock('../../../../lib/api/chats', () => ({
  getChat: vi.fn().mockResolvedValue(null),
  getChatWorkflowRuns: vi.fn().mockResolvedValue([]),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../lib/api/git', () => ({
  acceptWorktreeOffer: vi.fn().mockResolvedValue(undefined),
  dismissWorktreeOffer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), permission: vi.fn() },
}));

import { uploadAttachments } from '../../../../lib/api/attachments';
import { buildPendingMessage } from '../chat-reconcile';
import { createChatThreadState, reduceChatThreadState, type ChatThreadState } from '../chat-thread-state';
import { projectChatThreadMessages } from '../project-messages';
import { makeCompleteAttachment, makeController, makeMsg } from './acp-test-kit';

const IMAGE = { name: 'shot.png', mediaType: 'image/png', data: 'aGVsbG8=' };
const FILE = { name: 'notes.md', mediaType: 'text/markdown', data: 'aGVsbG8gd29ybGQ=' };

function queuedRef(overrides: Partial<QueuedMessageRef> = {}): QueuedMessageRef {
  return {
    messageId: 'm1',
    chatId: 'chat-1',
    uuid: 'u1',
    content: 'queued text',
    timestamp: '2026-10-17T07:12:00.000Z',
    ...overrides,
  };
}

function reduce(state: ChatThreadState, ...events: Parameters<typeof reduceChatThreadState>[1][]) {
  return events.reduce(reduceChatThreadState, state);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pending turn previews', () => {
  it('projects an image as an image part and a file as a sized file attachment', () => {
    const pending = buildPendingMessage('chat-1', 'look', {}, [IMAGE, FILE]);
    const state = reduce(createChatThreadState('chat-1'), { type: 'local.message.queued', pending });

    const [message] = projectChatThreadMessages(state);

    expect(message!.content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', image: 'data:image/png;base64,aGVsbG8=' },
    ]);
    expect(message!.attachments).toEqual([
      {
        id: 'notes.md',
        type: 'file',
        name: 'notes.md',
        contentType: 'text/markdown',
        content: [],
        status: { type: 'complete' },
      },
    ]);
    expect(message!.metadata.custom.mainframe).toMatchObject({
      pending: true,
      attachmentPreviews: [{ name: 'notes.md', kind: 'file', sizeBytes: 11, mediaType: 'text/markdown' }],
    });
  });

  it('stops previewing once the send fails, since a retry is text-only', () => {
    const pending = buildPendingMessage('chat-1', 'look', {}, [IMAGE]);
    const state = reduce(
      createChatThreadState('chat-1'),
      { type: 'local.message.queued', pending },
      { type: 'local.message.failed', clientId: pending.clientId, error: new Error('boom'), stage: 'send' },
    );

    const [message] = projectChatThreadMessages(state);

    expect(message!.content).toEqual([{ type: 'text', text: 'look' }]);
    expect(message!.attachments).toEqual([]);
  });
});

describe('queued turn previews', () => {
  it('a queued ref renders the previews stored under its attachment ids', () => {
    const state = reduce(
      createChatThreadState('chat-1'),
      { type: 'local.attachments.queued', previews: { 'att-1': IMAGE } },
      { type: 'queued.snapshot', refs: [queuedRef({ attachmentIds: ['att-1'] })] },
    );

    const [message] = projectChatThreadMessages(state);

    expect(message!.content).toEqual([
      { type: 'text', text: 'queued text' },
      { type: 'image', image: 'data:image/png;base64,aGVsbG8=' },
    ]);
    expect(message!.metadata.custom.mainframe).toMatchObject({ queued: true });
  });

  it('a queued ref with unknown attachment ids renders text only', () => {
    const state = reduce(createChatThreadState('chat-1'), {
      type: 'queued.snapshot',
      refs: [queuedRef({ attachmentIds: ['att-unknown'] })],
    });

    const [message] = projectChatThreadMessages(state);

    expect(message!.content).toEqual([{ type: 'text', text: 'queued text' }]);
  });

  it('drops a preview once its turn leaves the queue, keeping ones no snapshot has listed yet', () => {
    const state = reduce(
      createChatThreadState('chat-1'),
      { type: 'local.attachments.queued', previews: { 'att-1': IMAGE } },
      { type: 'queued.snapshot', refs: [queuedRef({ attachmentIds: ['att-1'] })] },
      { type: 'local.attachments.queued', previews: { 'att-2': FILE } },
      { type: 'queued.snapshot', refs: [] },
    );

    expect(state.queuedAttachmentPreviews).toEqual({ 'att-2': FILE });
  });
});

describe('AcpChatController.sendMessage — queued acceptance', () => {
  it('stores the uploaded previews under their daemon ids', async () => {
    vi.mocked(uploadAttachments).mockResolvedValueOnce(['id-001']);
    const { ctrl, acpClient } = makeController();
    acpClient.prompt = async (sessionId, text, extra) => {
      acpClient.promptCalls.push({ sessionId, text, extra });
      return { _meta: { '_mainframe.dev': { position: 1 } } } as Awaited<ReturnType<typeof acpClient.prompt>>;
    };

    await ctrl.sendMessage(makeMsg('later', [makeCompleteAttachment('photo.png')]));

    expect(ctrl.getState().queuedAttachmentPreviews).toEqual({
      'id-001': { name: 'photo.png', mediaType: 'image/png', data: 'aGVsbG8=' },
    });
    expect(ctrl.getState().pendingUserMessages).toEqual({});
  });
});
