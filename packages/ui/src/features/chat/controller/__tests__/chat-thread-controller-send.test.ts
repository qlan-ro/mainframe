/**
 * Behavior tests for AcpChatController.sendMessage.
 *
 * The send path no longer emits a raw `message.send` WS frame — it awaits
 * `load()` (which resolves the facade client + attaches the plane) then
 * calls `plane.sendPrompt`, which reaches the fake ACP client as a `prompt`
 * call carrying attachment ids under `_meta['_mainframe.dev']`. Optimistic
 * pending-state and failure-stage behavior are unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { CHAT_ID, PORT, makeCompleteAttachment, makeController, makeMsg } from './acp-test-kit';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AcpChatController.sendMessage — text-only', () => {
  it('prompts the facade client with the trimmed text and no attachmentIds meta', async () => {
    const { ctrl, acpClient } = makeController();

    await ctrl.sendMessage(makeMsg('  hello world  '));

    expect(acpClient.promptCalls).toEqual([{ sessionId: CHAT_ID, text: 'hello world', extra: {} }]);
  });

  it('creates a pending user message in state synchronously, before the send resolves', async () => {
    const { ctrl } = makeController();

    const promise = ctrl.sendMessage(makeMsg('my message'));
    const pendingDuring = Object.values(ctrl.getState().pendingUserMessages);
    await promise;

    expect(pendingDuring).toHaveLength(1);
    expect(pendingDuring[0]!.text).toBe('my message');
    expect(pendingDuring[0]!.status).toBe('pending');
  });

  it('does NOT call uploadAttachments when there are no attachments', async () => {
    const { ctrl } = makeController();
    await ctrl.sendMessage(makeMsg('plain text'));
    expect(uploadAttachments).not.toHaveBeenCalled();
  });
});

describe('AcpChatController.sendMessage — with attachments', () => {
  it('uploads then prompts with the returned ids under _mainframe.dev', async () => {
    vi.mocked(uploadAttachments).mockResolvedValueOnce(['id-001', 'id-002']);
    const { ctrl, acpClient } = makeController();

    await ctrl.sendMessage(makeMsg('attach this', [makeCompleteAttachment('photo.png')]));

    expect(uploadAttachments).toHaveBeenCalledOnce();
    expect(acpClient.promptCalls).toEqual([
      {
        sessionId: CHAT_ID,
        text: 'attach this',
        extra: { _meta: { '_mainframe.dev': { attachmentIds: ['id-001', 'id-002'] } } },
      },
    ]);
  });

  it('passes the correct port/chatId and base64 payload (no data: prefix) to uploadAttachments', async () => {
    vi.mocked(uploadAttachments).mockResolvedValueOnce(['id-x']);
    const { ctrl } = makeController();

    await ctrl.sendMessage(makeMsg('hi', [makeCompleteAttachment('img.png')]));

    const [portArg, chatIdArg, items] = vi.mocked(uploadAttachments).mock.calls[0]!;
    expect(portArg).toBe(PORT);
    expect(chatIdArg).toBe(CHAT_ID);
    expect(items).toEqual([{ name: 'img.png', mediaType: 'image/png', data: 'aGVsbG8=' }]);
  });
});

describe('AcpChatController.sendMessage — attachment only (no text)', () => {
  it('prompts with empty text and the attachment ids', async () => {
    vi.mocked(uploadAttachments).mockResolvedValueOnce(['id-att']);
    const { ctrl, acpClient } = makeController();

    await ctrl.sendMessage(makeMsg('', [makeCompleteAttachment('diagram.png')]));

    expect(acpClient.promptCalls).toEqual([
      { sessionId: CHAT_ID, text: '', extra: { _meta: { '_mainframe.dev': { attachmentIds: ['id-att'] } } } },
    ]);
  });
});

describe('AcpChatController.sendMessage — both-empty early return', () => {
  it('does not prompt, upload, or change runState when text and attachments are both empty', async () => {
    const { ctrl, acpClient } = makeController();

    await ctrl.sendMessage(makeMsg('', []));

    expect(acpClient.promptCalls).toHaveLength(0);
    expect(uploadAttachments).not.toHaveBeenCalled();
    expect(ctrl.getState().runState.type).toBe('idle');
  });
});

describe('AcpChatController.sendMessage — role guard', () => {
  it('does nothing for a non-user message', async () => {
    const { ctrl, acpClient } = makeController();
    const assistantMsg = {
      role: 'assistant',
      content: [{ type: 'text', text: 'assistant says hi' }],
      attachments: [],
      parentId: null,
    } as unknown as Parameters<typeof ctrl.sendMessage>[0];

    await ctrl.sendMessage(assistantMsg);

    expect(acpClient.promptCalls).toHaveLength(0);
    expect(uploadAttachments).not.toHaveBeenCalled();
  });
});

describe('AcpChatController.sendMessage — upload failure', () => {
  it('marks the pending failed with stage upload and transitions runState to error', async () => {
    const uploadError = new Error('network timeout');
    vi.mocked(uploadAttachments).mockRejectedValueOnce(uploadError);
    const { ctrl, acpClient } = makeController();

    await expect(ctrl.sendMessage(makeMsg('with attachment', [makeCompleteAttachment('fail.png')]))).rejects.toThrow(
      'network timeout',
    );

    const state = ctrl.getState();
    expect(state.runState).toEqual({ type: 'error', error: uploadError });
    const pending = Object.values(state.pendingUserMessages);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ status: 'failed', error: uploadError, stage: 'upload' });
    expect(acpClient.promptCalls).toHaveLength(0);
  });
});

describe('AcpChatController.sendMessage — send failure', () => {
  it('records stage "send" when the prompt call itself throws (upload already succeeded)', async () => {
    vi.mocked(uploadAttachments).mockResolvedValueOnce(['id-1']);
    const { ctrl, acpClient } = makeController();
    const sendError = new Error('socket closed');
    acpClient.prompt = vi.fn().mockRejectedValueOnce(sendError);

    await ctrl.sendMessage(makeMsg('with attachment', [makeCompleteAttachment('a.png')])).catch(() => {});

    const pending = Object.values(ctrl.getState().pendingUserMessages)[0]!;
    expect(pending.stage).toBe('send');
  });

  it('records stage "send" for a text-only message whose prompt call throws', async () => {
    const { ctrl, acpClient } = makeController();
    acpClient.prompt = vi.fn().mockRejectedValueOnce(new Error('socket closed'));

    await ctrl.sendMessage(makeMsg('text only')).catch(() => {});

    expect(Object.values(ctrl.getState().pendingUserMessages)[0]!.stage).toBe('send');
  });

  it('marks attachmentsRestored on markAttachmentsRestoredForFailure after a send-stage failure', async () => {
    vi.mocked(uploadAttachments).mockResolvedValueOnce(['id-1']);
    const { ctrl, acpClient } = makeController();
    const sendError = new Error('socket closed');
    acpClient.prompt = vi.fn().mockRejectedValueOnce(sendError);

    await ctrl.sendMessage(makeMsg('with attachment', [makeCompleteAttachment('a.png')])).catch(() => {});
    ctrl.markAttachmentsRestoredForFailure(sendError);

    const pending = Object.values(ctrl.getState().pendingUserMessages)[0]!;
    expect(pending.stage).toBe('send');
    expect(pending.attachmentsRestored).toBe(true);
  });
});
