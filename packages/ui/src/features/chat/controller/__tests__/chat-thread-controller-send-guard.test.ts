/**
 * Behavior tests for the controller-level missing-directory send guard.
 *
 * When the chat's effective working directory is gone (`chatConfig.directoryMissing`,
 * seeded from a `chat.updated` side-band broadcast), send and retry must stop
 * before any optimistic state or prompt is produced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), permission: vi.fn() },
}));
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

import { mfToast } from '@/lib/toast';
import { uploadAttachments } from '../../../../lib/api/attachments';
import { CHAT_ID, makeChat, makeCompleteAttachment, makeController, makeMsg } from './acp-test-kit';

function seedChat(rig: ReturnType<typeof makeController>, overrides: Parameters<typeof makeChat>[0]): void {
  rig.ctrl.subscribeLive();
  rig.ws.pushEvent({ type: 'chat.updated', chat: makeChat(overrides) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AcpChatController — missing directory send guard', () => {
  it('refuses sendMessage before creating a pending or prompting', async () => {
    const rig = makeController();
    seedChat(rig, { directoryMissing: true, missingDirectoryPath: '/gone/proj' });

    await rig.ctrl.sendMessage(makeMsg('hello'));

    expect(rig.acpClient.promptCalls).toHaveLength(0);
    expect(Object.values(rig.ctrl.getState().pendingUserMessages)).toEqual([]);
    expect(rig.ctrl.getState().runState).toEqual({ type: 'idle' });
    expect(mfToast.error).toHaveBeenCalledOnce();
    expect(vi.mocked(mfToast.error).mock.calls[0]![1]).toEqual({ description: '/gone/proj' });
  });

  it('refuses retryMessage without changing the failed pending', async () => {
    const rig = makeController();
    vi.mocked(uploadAttachments).mockRejectedValueOnce(new Error('upload failed'));
    await rig.ctrl.sendMessage(makeMsg('retry me', [makeCompleteAttachment('a.png')])).catch(() => {});
    const failed = Object.values(rig.ctrl.getState().pendingUserMessages)[0]!;
    seedChat(rig, { directoryMissing: true, missingDirectoryPath: '/gone/proj' });

    await rig.ctrl.retryMessage(failed.clientId);

    expect(rig.acpClient.promptCalls).toHaveLength(0);
    expect(rig.ctrl.getState().pendingUserMessages[failed.clientId]).toMatchObject({
      clientId: failed.clientId,
      text: 'retry me',
      status: 'failed',
    });
    expect(mfToast.error).toHaveBeenCalledOnce();
    expect(vi.mocked(mfToast.error).mock.calls[0]![1]).toEqual({ description: '/gone/proj' });
  });

  it('still sends and retries when the directory is available', async () => {
    const rig = makeController();
    seedChat(rig, { directoryMissing: false });

    await rig.ctrl.sendMessage(makeMsg('hello'));

    expect(rig.acpClient.promptCalls).toEqual([{ sessionId: CHAT_ID, text: 'hello', extra: {} }]);

    vi.mocked(uploadAttachments).mockRejectedValueOnce(new Error('upload failed'));
    await rig.ctrl.sendMessage(makeMsg('retry me', [makeCompleteAttachment('a.png')])).catch(() => {});
    const failed = Object.values(rig.ctrl.getState().pendingUserMessages).find((p) => p.text === 'retry me')!;

    await rig.ctrl.retryMessage(failed.clientId);

    expect(rig.acpClient.promptCalls[rig.acpClient.promptCalls.length - 1]).toEqual({
      sessionId: CHAT_ID,
      text: 'retry me',
      extra: {},
    });
  });
});
