// @vitest-environment jsdom
/**
 * The per-chat "user sent" event (`user-sent.ts`): the controller emits it
 * for the user's own sends only. A prompt the daemon dispatches by itself
 * (a held prompt released at turn end) must not emit it, so a reader who
 * scrolled up stays where they are.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/api/attachments', () => ({ uploadAttachments: vi.fn() }));
vi.mock('../../../../lib/api/chats', () => ({
  getChat: vi.fn().mockResolvedValue(null),
  getChatWorkflowRuns: vi.fn().mockResolvedValue([]),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(true),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
  resumeQueuedMessages: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../lib/api/git', () => ({
  acceptWorktreeOffer: vi.fn().mockResolvedValue(undefined),
  dismissWorktreeOffer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), permission: vi.fn() },
}));

import { resumeQueuedMessages } from '../../../../lib/api/chats';
import { uploadAttachments } from '../../../../lib/api/attachments';
import { useHeldQueue } from '../../composer/queue/held-queue-store';
import { emitUserSent, onUserSent } from '../user-sent';
import {
  CHAT_ID,
  PORT,
  flushMicrotasks,
  makeChat,
  makeCompleteAttachment,
  makeController,
  makeMsg,
  userMessageUpdate,
} from './acp-test-kit';

const heard = vi.fn();
let stop: () => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useHeldQueue.setState({ byChat: {} });
  stop = onUserSent(CHAT_ID, heard);
});
afterEach(() => stop());

const queuedRef = {
  messageId: 'q1',
  chatId: CHAT_ID,
  uuid: 'u-q1',
  content: 'queued while running',
  timestamp: '2026-11-24T10:00:01.000Z',
};

describe('onUserSent', () => {
  it('hears only its own chat, once per emit even when both of a chat’s ids are named', () => {
    const other = vi.fn();
    const stopOther = onUserSent('chat-other', other);
    emitUserSent([CHAT_ID, CHAT_ID]);
    expect(heard).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
    stopOther();
  });

  it('stops hearing once unsubscribed', () => {
    stop();
    emitUserSent([CHAT_ID]);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('AcpChatController — the user’s own sends', () => {
  it('a composer send, queue or steer, Compact or review comment (all sendMessage)', async () => {
    const { ctrl } = makeController();
    const sent = ctrl.sendMessage(makeMsg('hello'));
    // Announced once the optimistic bubble is in state, before the send resolves.
    expect(Object.values(ctrl.getState().pendingUserMessages)).toHaveLength(1);
    expect(heard).toHaveBeenCalledOnce();
    await sent;
  });

  it('Send now on a held row', async () => {
    const { ctrl } = makeController();
    useHeldQueue.getState().hold(CHAT_ID, queuedRef);
    await ctrl.sendHeld('q1');
    expect(heard).toHaveBeenCalledOnce();
  });

  it('Resume on a paused queue', async () => {
    const { ctrl } = makeController();
    await ctrl.resumeQueue();
    expect(resumeQueuedMessages).toHaveBeenCalledExactlyOnceWith(PORT, CHAT_ID);
    expect(heard).toHaveBeenCalledOnce();
  });
});

describe('AcpChatController — nothing went out, nothing is announced', () => {
  it('a send into a chat whose working directory is gone', async () => {
    const rig = makeController();
    rig.ctrl.subscribeLive();
    rig.ws.pushEvent({
      type: 'chat.updated',
      chat: makeChat({ directoryMissing: true, missingDirectoryPath: '/gone' }),
    });
    await rig.ctrl.sendMessage(makeMsg('hello'));
    expect(heard).not.toHaveBeenCalled();
  });

  it('a send with nothing in it', async () => {
    const { ctrl } = makeController();
    await ctrl.sendMessage(makeMsg('   '));
    expect(heard).not.toHaveBeenCalled();
  });

  it('Send now when another press already claimed the rows', async () => {
    const { ctrl } = makeController();
    await ctrl.sendHeld('missing-row');
    expect(heard).not.toHaveBeenCalled();
  });

  it('Send now when the daemon refuses the prompt', async () => {
    const { ctrl, acpClient } = makeController();
    useHeldQueue.getState().hold(CHAT_ID, queuedRef);
    vi.spyOn(acpClient, 'prompt').mockRejectedValueOnce(new Error('refused'));
    await ctrl.sendHeld('q1').catch(() => {});
    expect(heard).not.toHaveBeenCalled();
  });

  it('Resume when the request fails', async () => {
    const { ctrl } = makeController();
    vi.mocked(resumeQueuedMessages).mockRejectedValueOnce(new Error('offline'));
    await ctrl.resumeQueue().catch(() => {});
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('AcpChatController — Retry on a "Failed to send" bubble', () => {
  it('re-pins like any user send', async () => {
    const { ctrl } = makeController();
    vi.mocked(uploadAttachments).mockRejectedValueOnce(new Error('boom'));
    await ctrl.sendMessage(makeMsg('retry me', [makeCompleteAttachment('f.png')])).catch(() => {});
    const failed = Object.values(ctrl.getState().pendingUserMessages)[0]!;
    expect(failed.status).toBe('failed');
    heard.mockClear();

    await ctrl.retryMessage(failed.clientId);
    expect(heard).toHaveBeenCalledOnce();
  });
});

describe('AcpChatController — prompts the user did not send', () => {
  it('a held prompt the daemon dispatches at turn end does not emit', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.load();
    acpClient.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'running' });
    acpClient.emitQueueState(CHAT_ID, [queuedRef]);
    // The turn ends; the daemon releases the queued prompt as the next turn.
    acpClient.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
    acpClient.emitQueueState(CHAT_ID, []);
    acpClient.emitUpdate(CHAT_ID, userMessageUpdate('q1', 'queued while running'));
    acpClient.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'running' });
    await flushMicrotasks();

    expect(ctrl.getState().runState.type).toBe('running');
    expect(Object.values(ctrl.getState().interactions.queued)).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
  });
});
