/**
 * Behavior tests for ChatThreadController.sendMessage.
 *
 * Focus: the send-vs-skip guard, the attachment upload branch, and the
 * error-dispatch path.  Daemon WS calls are captured by a fake client;
 * the REST layer (uploadAttachments, getChatMessages, resumeChat) is
 * vi.mock'd so no network traffic occurs.
 *
 * Fake ws client
 * --------------
 * The controller only needs: send(), onEvent(), subscribe(), unsubscribe(),
 * subscribeConnection(), and the `connected` getter.  We provide a plain
 * object (no class) that satisfies DaemonWsClient's public surface and
 * records every send() call for assertion.
 *
 * Mock modules
 * ------------
 * - lib/api/attachments → uploadAttachments (resolved/rejected per test)
 * - lib/api/chats       → getChatMessages, resumeChat (silently resolved so
 *   ensureWsSubscription and load() don't throw)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppendMessage } from '@assistant-ui/react';
import type { ClientEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

// ---------------------------------------------------------------------------
// Mock the REST modules before importing the controller (hoisted by vitest).
// ---------------------------------------------------------------------------

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn(),
}));

vi.mock('../../../../lib/api/chats', () => ({
  getChatMessages: vi.fn().mockResolvedValue([]),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));

import { uploadAttachments } from '../../../../lib/api/attachments';
import { ChatThreadController } from '../chat-thread-controller';

// ---------------------------------------------------------------------------
// Fake WS client factory
// ---------------------------------------------------------------------------

interface FakeWs {
  sentEvents: ClientEvent[];
  fakeClient: DaemonWsClient;
}

function makeFakeWs(): FakeWs {
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
    // The rest of the public surface is not called during sendMessage.
    setPort: () => {},
    connect: () => {},
    disconnect: () => {},
  } as unknown as DaemonWsClient;

  return { sentEvents, fakeClient };
}

// ---------------------------------------------------------------------------
// AppendMessage builder
// ---------------------------------------------------------------------------

function makeMsg(overrides: { text?: string; attachments?: NonNullable<AppendMessage['attachments']> }): AppendMessage {
  const text = overrides.text ?? '';
  // Partial fixture: sendMessage only reads role/content/attachments.
  return {
    role: 'user',
    content: text ? [{ type: 'text', text }] : [],
    attachments: overrides.attachments ?? [],
    parentId: null,
  } as unknown as AppendMessage;
}

// A minimal CompleteAttachment whose content part is an image data-URL.
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

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const CHAT_ID = 'chat-abc';
const PORT = 9999;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Text-only send — emits message.send frame with text, no attachmentIds
// ---------------------------------------------------------------------------

describe('ChatThreadController.sendMessage — text-only', () => {
  it('emits a message.send frame with the trimmed text and no attachmentIds', async () => {
    const { sentEvents, fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    await ctrl.sendMessage(makeMsg({ text: '  hello world  ' }));

    const sends = sentEvents.filter((e) => e.type === 'message.send');
    expect(sends).toHaveLength(1);
    expect(sends[0]).toEqual({
      type: 'message.send',
      chatId: CHAT_ID,
      content: 'hello world',
      // No attachmentIds key at all when there are no attachments.
    });
  });

  it('creates a pending user message in state before the WS send', async () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    let stateBeforeSend: ReturnType<typeof ctrl.getState> | null = null;
    // Capture the state at the moment of the first send() call.
    const spy = vi.spyOn(fakeClient, 'send').mockImplementationOnce(() => {
      stateBeforeSend = ctrl.getState();
    });

    await ctrl.sendMessage(makeMsg({ text: 'my message' }));
    spy.mockRestore();

    // The pending message must be in state when the WS frame is emitted.
    expect(stateBeforeSend).not.toBeNull();
    const pending = Object.values(stateBeforeSend!.pendingUserMessages);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.text).toBe('my message');
    expect(pending[0]!.status).toBe('pending');
  });

  it('does NOT call uploadAttachments when there are no attachments', async () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    await ctrl.sendMessage(makeMsg({ text: 'plain text' }));

    expect(uploadAttachments).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. With attachments — awaits upload then sends attachmentIds
// ---------------------------------------------------------------------------

describe('ChatThreadController.sendMessage — with attachments', () => {
  it('calls uploadAttachments then sends the returned ids in the WS frame', async () => {
    vi.mocked(uploadAttachments).mockResolvedValueOnce(['id-001', 'id-002']);

    const { sentEvents, fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    await ctrl.sendMessage(
      makeMsg({
        text: 'attach this',
        attachments: [makeCompleteAttachment('photo.png')],
      }),
    );

    expect(uploadAttachments).toHaveBeenCalledOnce();

    const sends = sentEvents.filter((e) => e.type === 'message.send');
    expect(sends).toHaveLength(1);
    expect(sends[0]).toEqual({
      type: 'message.send',
      chatId: CHAT_ID,
      content: 'attach this',
      attachmentIds: ['id-001', 'id-002'],
    });
  });

  it('passes the correct chatId and port to uploadAttachments', async () => {
    vi.mocked(uploadAttachments).mockResolvedValueOnce(['id-x']);

    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    await ctrl.sendMessage(
      makeMsg({
        text: 'hi',
        attachments: [makeCompleteAttachment('file.pdf')],
      }),
    );

    const [portArg, chatIdArg] = vi.mocked(uploadAttachments).mock.calls[0]!;
    expect(portArg).toBe(PORT);
    expect(chatIdArg).toBe(CHAT_ID);
  });

  it('includes the base64 data (without data: prefix) in the upload payload', async () => {
    vi.mocked(uploadAttachments).mockResolvedValueOnce(['id-y']);

    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    await ctrl.sendMessage(
      makeMsg({
        text: 'hi',
        attachments: [makeCompleteAttachment('img.png')],
      }),
    );

    const items = vi.mocked(uploadAttachments).mock.calls[0]![2];
    expect(items).toEqual([{ name: 'img.png', mediaType: 'image/png', data: 'aGVsbG8=' }]);
  });
});

// ---------------------------------------------------------------------------
// 3. Attachment-only (no text) — still sends
// ---------------------------------------------------------------------------

describe('ChatThreadController.sendMessage — attachment only (no text)', () => {
  it('sends a message.send frame with empty content when there is no text', async () => {
    vi.mocked(uploadAttachments).mockResolvedValueOnce(['id-att']);

    const { sentEvents, fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    await ctrl.sendMessage(
      makeMsg({
        text: '',
        attachments: [makeCompleteAttachment('diagram.png')],
      }),
    );

    const sends = sentEvents.filter((e) => e.type === 'message.send');
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      type: 'message.send',
      chatId: CHAT_ID,
      content: '',
      attachmentIds: ['id-att'],
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Both-empty guard — no send, no upload
// ---------------------------------------------------------------------------

describe('ChatThreadController.sendMessage — both-empty early return', () => {
  it('does not emit any WS message when text is empty and there are no attachments', async () => {
    const { sentEvents, fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    await ctrl.sendMessage(makeMsg({ text: '', attachments: [] }));

    expect(sentEvents.filter((e) => e.type === 'message.send')).toHaveLength(0);
  });

  it('does not call uploadAttachments when both are absent', async () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    await ctrl.sendMessage(makeMsg({ text: '', attachments: [] }));

    expect(uploadAttachments).not.toHaveBeenCalled();
  });

  it('does not change runState when the send is skipped', async () => {
    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    await ctrl.sendMessage(makeMsg({ text: '', attachments: [] }));

    expect(ctrl.getState().runState.type).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// 5. uploadAttachments rejects — dispatches failed state and rethrows
// ---------------------------------------------------------------------------

describe('ChatThreadController.sendMessage — upload failure', () => {
  it('marks the pending message as failed and transitions runState to error when upload rejects', async () => {
    const uploadError = new Error('network timeout');
    vi.mocked(uploadAttachments).mockRejectedValueOnce(uploadError);

    const { fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    await expect(
      ctrl.sendMessage(
        makeMsg({
          text: 'with attachment',
          attachments: [makeCompleteAttachment('fail.png')],
        }),
      ),
    ).rejects.toThrow('network timeout');

    const state = ctrl.getState();
    // runState must reflect the failure.
    expect(state.runState.type).toBe('error');

    // The pending message must be in 'failed' status.
    const pendingValues = Object.values(state.pendingUserMessages);
    expect(pendingValues).toHaveLength(1);
    expect(pendingValues[0]!.status).toBe('failed');
    expect(pendingValues[0]!.error).toBe(uploadError);
  });

  it('does not send any WS message when upload fails', async () => {
    vi.mocked(uploadAttachments).mockRejectedValueOnce(new Error('upload gone'));

    const { sentEvents, fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    await ctrl.sendMessage(makeMsg({ text: 'x', attachments: [makeCompleteAttachment('f.png')] })).catch(() => {});

    expect(sentEvents.filter((e) => e.type === 'message.send')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Non-user role — skipped unconditionally
// ---------------------------------------------------------------------------

describe('ChatThreadController.sendMessage — role guard', () => {
  it('does nothing when the message role is not user', async () => {
    const { sentEvents, fakeClient } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);

    const assistantMsg = {
      role: 'assistant',
      content: [{ type: 'text', text: 'assistant says hi' }],
      attachments: [],
      parentId: null,
    } as unknown as AppendMessage;

    await ctrl.sendMessage(assistantMsg);

    expect(sentEvents.filter((e) => e.type === 'message.send')).toHaveLength(0);
    expect(uploadAttachments).not.toHaveBeenCalled();
  });
});
