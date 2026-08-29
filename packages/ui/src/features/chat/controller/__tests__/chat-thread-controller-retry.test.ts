/**
 * Behavior tests for AcpChatController.retryMessage.
 *
 * A failed optimistic send leaves a `status: 'failed'` pending (the "Failed
 * to send" indicator). retryMessage re-prompts the plane with that pending's
 * text, flips it back to 'pending', clears the error, and resumes running.
 * Attachments are NOT re-uploaded (text-only retry).
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
import { CHAT_ID, makeCompleteAttachment, makeController, makeMsg } from './acp-test-kit';

beforeEach(() => {
  vi.clearAllMocks();
});

/** Seed a failed pending via an upload rejection, so it carries stage:'upload'. */
async function seedFailedPending(ctrl: ReturnType<typeof makeController>['ctrl'], text: string): Promise<string> {
  vi.mocked(uploadAttachments).mockRejectedValueOnce(new Error('boom'));
  await ctrl.sendMessage(makeMsg(text, [makeCompleteAttachment('f.png')])).catch(() => {});
  const failed = Object.values(ctrl.getState().pendingUserMessages)[0];
  expect(failed?.status).toBe('failed');
  expect(failed?.stage).toBe('upload');
  return failed!.clientId;
}

describe('AcpChatController.retryMessage', () => {
  it('re-prompts with the failed message text', async () => {
    const { ctrl, acpClient } = makeController();
    const clientId = await seedFailedPending(ctrl, 'retry me');

    await ctrl.retryMessage(clientId);

    expect(acpClient.promptCalls[acpClient.promptCalls.length - 1]).toEqual({
      sessionId: CHAT_ID,
      text: 'retry me',
      extra: {},
    });
  });

  it('flips the pending back to pending, clears the error, and resumes running', async () => {
    const { ctrl } = makeController();
    const clientId = await seedFailedPending(ctrl, 'retry me');

    await ctrl.retryMessage(clientId);

    const after = ctrl.getState().pendingUserMessages[clientId];
    expect(after?.status).toBe('pending');
    expect(after?.error).toBeUndefined();
    expect(ctrl.getState().runState.type).toBe('running');
  });

  it('is a no-op when the clientId is unknown', async () => {
    const { ctrl, acpClient } = makeController();

    await ctrl.retryMessage('does-not-exist');

    expect(acpClient.promptCalls).toHaveLength(0);
  });

  it('does not re-upload attachments on retry', async () => {
    vi.mocked(uploadAttachments).mockRejectedValueOnce(new Error('boom'));
    const { ctrl } = makeController();
    await ctrl.sendMessage(makeMsg('retry me', [makeCompleteAttachment('f.png')])).catch(() => {});
    const clientId = Object.values(ctrl.getState().pendingUserMessages)[0]!.clientId;
    vi.mocked(uploadAttachments).mockClear();

    await ctrl.retryMessage(clientId);

    expect(uploadAttachments).not.toHaveBeenCalled();
  });
});

describe('AcpChatController.retryMessage — failure stage', () => {
  it('clears the upload stage when the retry is accepted', async () => {
    const { ctrl } = makeController();
    const clientId = await seedFailedPending(ctrl, 'retry me');
    expect(ctrl.getState().pendingUserMessages[clientId]?.stage).toBe('upload');

    await ctrl.retryMessage(clientId);

    expect(ctrl.getState().pendingUserMessages[clientId]?.stage).toBeUndefined();
  });

  it("records stage 'send' when the retry prompt itself throws", async () => {
    const { ctrl, acpClient } = makeController();
    const clientId = await seedFailedPending(ctrl, 'retry me');
    acpClient.prompt = vi.fn().mockRejectedValueOnce(new Error('socket closed'));

    await ctrl.retryMessage(clientId).catch(() => {});

    expect(ctrl.getState().pendingUserMessages[clientId]?.stage).toBe('send');
  });
});
