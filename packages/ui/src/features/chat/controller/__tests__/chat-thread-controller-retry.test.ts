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
  unarchiveNativeSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../lib/api/git', () => ({
  acceptWorktreeOffer: vi.fn().mockResolvedValue(undefined),
  dismissWorktreeOffer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), permission: vi.fn() },
}));

import type { CustomCommand } from '@qlan-ro/mainframe-types';
import { uploadAttachments } from '../../../../lib/api/attachments';
import { unarchiveNativeSession } from '../../../../lib/api/chats';
import { publishCommands } from '../../commands/command-registry';
import { CHAT_ID, makeCompleteAttachment, makeController, makeMsg } from './acp-test-kit';

const COMMANDS: CustomCommand[] = [{ name: 'review', description: 'Review the diff', source: 'mainframe' }];

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

  it("with the unarchive remedy, unarchives the chat's provider session before re-prompting", async () => {
    const { ctrl, acpClient } = makeController();
    const clientId = await seedFailedPending(ctrl, 'retry me');
    const promptsBefore = acpClient.promptCalls.length;

    await ctrl.retryMessage(clientId, 'unarchive_native_session');

    expect(vi.mocked(unarchiveNativeSession)).toHaveBeenCalledWith(expect.any(Number), CHAT_ID);
    expect(acpClient.promptCalls).toHaveLength(promptsBefore + 1);
  });

  it('a failed unarchive leaves the message failed and never re-prompts', async () => {
    const { ctrl, acpClient } = makeController();
    const clientId = await seedFailedPending(ctrl, 'retry me');
    const promptsBefore = acpClient.promptCalls.length;
    vi.mocked(unarchiveNativeSession).mockRejectedValueOnce(new Error('thread not found'));

    await expect(ctrl.retryMessage(clientId, 'unarchive_native_session')).rejects.toThrow('thread not found');

    expect(acpClient.promptCalls).toHaveLength(promptsBefore);
    expect(ctrl.getState().pendingUserMessages[clientId]?.status).toBe('failed');
  });

  it('a plain retry never unarchives', async () => {
    const { ctrl } = makeController();
    const clientId = await seedFailedPending(ctrl, 'retry me');

    await ctrl.retryMessage(clientId);

    expect(vi.mocked(unarchiveNativeSession)).not.toHaveBeenCalled();
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

describe('AcpChatController.retryMessage — command re-invocation (T34, R3.22)', () => {
  it('retrying a failed /command resend carries its command meta, not just the literal text', async () => {
    publishCommands(COMMANDS);
    const { ctrl, acpClient } = makeController();
    const realPrompt = acpClient.prompt.bind(acpClient);
    let failNext = true;
    acpClient.prompt = ((...args: Parameters<typeof realPrompt>) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error('socket closed'));
      }
      return realPrompt(...args);
    }) as typeof acpClient.prompt;
    await ctrl.sendMessage(makeMsg('/review')).catch(() => {});
    const clientId = Object.values(ctrl.getState().pendingUserMessages)[0]!.clientId;

    await ctrl.retryMessage(clientId);

    const last = acpClient.promptCalls[acpClient.promptCalls.length - 1]!;
    expect(last.extra?._meta?.['_mainframe.dev']).toMatchObject({ command: { name: 'review' } });
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
