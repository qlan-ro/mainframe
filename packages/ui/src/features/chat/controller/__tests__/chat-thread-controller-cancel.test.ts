// @vitest-environment jsdom
/**
 * Behavior tests for AcpChatController.cancel — the idle guard (todo #324 QA):
 * cancelling an already-idle chat must not strand runState at 'cancelling',
 * since the daemon has nothing to broadcast that would clear it.
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

import { cancelQueuedMessage } from '../../../../lib/api/chats';
import { useHeldQueue } from '../../composer/queue/held-queue-store';
import { CHAT_ID, makeController } from './acp-test-kit';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useHeldQueue.setState({ byChat: {} });
});

describe('AcpChatController.cancel — idle guard', () => {
  it('does not dispatch run.cancelling or call plane.cancel when runState is idle', async () => {
    const { ctrl, acpClient } = makeController();

    await ctrl.cancel();

    expect(ctrl.getState().runState).toEqual({ type: 'idle' });
    expect(acpClient.cancelCalls).toHaveLength(0);
  });

  it('still cancels a genuinely running chat', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.load();
    acpClient.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'running' });

    await ctrl.cancel();

    expect(ctrl.getState().runState).toEqual({ type: 'cancelling' });
    expect(acpClient.cancelCalls).toEqual([CHAT_ID]);
  });
});

describe('AcpChatController.cancel — holds the queue first (C10)', () => {
  const queuedRef = (messageId: string, second: number) => ({
    messageId,
    chatId: CHAT_ID,
    uuid: `u-${messageId}`,
    content: `queued ${messageId}`,
    timestamp: `2026-11-24T10:00:0${second}.000Z`,
  });

  it('takes the queued messages back before interrupting, and keeps them held', async () => {
    const order: string[] = [];
    vi.mocked(cancelQueuedMessage).mockImplementation(async (_port, _chat, id) => {
      order.push(`cancel-queued:${id}`);
    });
    const { ctrl, acpClient } = makeController();
    await ctrl.load();
    acpClient.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'running' });
    acpClient.emitQueueState(CHAT_ID, [queuedRef('m1', 1), queuedRef('m2', 2)]);
    const plane = acpClient.cancelCalls;
    const realPush = plane.push.bind(plane);
    plane.push = (...items: string[]) => {
      order.push('interrupt');
      return realPush(...items);
    };

    await ctrl.cancel();

    expect(order.slice(-1)).toEqual(['interrupt']);
    expect(order.filter((step) => step.startsWith('cancel-queued')).sort()).toEqual([
      'cancel-queued:m1',
      'cancel-queued:m2',
    ]);
    expect(useHeldQueue.getState().byChat[CHAT_ID]!.map((row) => row.messageId)).toEqual(['m1', 'm2']);
  });

  it('does not touch the queue when the chat is idle', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.load();
    acpClient.emitQueueState(CHAT_ID, [queuedRef('m1', 1)]);

    await ctrl.cancel();

    expect(cancelQueuedMessage).not.toHaveBeenCalled();
    expect(useHeldQueue.getState().byChat).toEqual({});
  });

  it('sendHeld sends the held message through the session', async () => {
    useHeldQueue.getState().hold(CHAT_ID, queuedRef('m1', 1));
    const { ctrl, acpClient } = makeController();
    await ctrl.load();

    await ctrl.sendHeld('m1');

    expect(acpClient.promptCalls).toEqual([{ sessionId: CHAT_ID, text: 'queued m1', extra: {} }]);
    expect(useHeldQueue.getState().byChat).toEqual({});
  });
});
