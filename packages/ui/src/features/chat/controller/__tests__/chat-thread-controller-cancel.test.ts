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
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(true),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../lib/api/git', () => ({
  acceptWorktreeOffer: vi.fn().mockResolvedValue(undefined),
  dismissWorktreeOffer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), permission: vi.fn() },
}));

import { cancelQueuedMessage, getChat, interruptChat } from '../../../../lib/api/chats';
import { useHeldQueue } from '../../composer/queue/held-queue-store';
import { forgetSent, noteQueued } from '../../composer/queue/sent-order';
import { CHAT_ID, makeChat, makeController } from './acp-test-kit';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useHeldQueue.setState({ byChat: {} });
  forgetSent(CHAT_ID);
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

describe('AcpChatController.cancel — queued messages (C10)', () => {
  const queuedRef = (messageId: string, second: number) => ({
    messageId,
    chatId: CHAT_ID,
    uuid: `u-${messageId}`,
    content: `queued ${messageId}`,
    timestamp: `2026-11-24T10:00:0${second}.000Z`,
  });

  it('takes adapter-owned queued messages back before interrupting', async () => {
    vi.mocked(getChat).mockResolvedValueOnce(makeChat({ adapterId: 'mock' }));
    const order: string[] = [];
    vi.mocked(cancelQueuedMessage).mockImplementation(async (_port, _chat, id) => {
      order.push(`cancel-queued:${id}`);
      return true;
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
    const held = useHeldQueue.getState().byChat[CHAT_ID]!;
    expect(held.map((row) => row.messageId)).toEqual(['m1', 'm2']);
    expect(held.map((row) => row.projectId)).toEqual(['p1', 'p1']);
  });

  it.each(['claude', 'codex'])('keeps %s prompts in the daemon queue on Stop', async (adapterId) => {
    vi.mocked(getChat).mockResolvedValueOnce(makeChat({ adapterId }));
    const { ctrl, acpClient } = makeController();
    await ctrl.load();
    acpClient.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'running' });
    acpClient.emitQueueState(CHAT_ID, [queuedRef('m1', 1)]);

    await ctrl.cancel();

    expect(acpClient.cancelCalls).toEqual([CHAT_ID]);
    expect(cancelQueuedMessage).not.toHaveBeenCalled();
    expect(useHeldQueue.getState().byChat).toEqual({});
    expect(Object.values(ctrl.getState().interactions.queued)).toEqual([queuedRef('m1', 1)]);
  });

  it('sends Stop to the daemon when a managed queue is idle', async () => {
    vi.mocked(getChat).mockResolvedValueOnce(makeChat());
    const { ctrl } = makeController();
    await ctrl.load();

    await ctrl.cancel();

    expect(interruptChat).toHaveBeenCalledOnce();
    expect(ctrl.getState().runState).toEqual({ type: 'idle' });
  });

  it('does not touch the queue when the chat is idle', async () => {
    const { ctrl, acpClient } = makeController();
    await ctrl.load();
    acpClient.emitQueueState(CHAT_ID, [queuedRef('m1', 1)]);

    await ctrl.cancel();

    expect(cancelQueuedMessage).not.toHaveBeenCalled();
    expect(useHeldQueue.getState().byChat).toEqual({});
  });

  it('a Stop gives back the held rows Send now has not sent, whether or not a turn shows yet', async () => {
    useHeldQueue.getState().hold(CHAT_ID, queuedRef('m1', 1));
    useHeldQueue.getState().hold(CHAT_ID, queuedRef('m2', 2));
    useHeldQueue.getState().claimFrom(CHAT_ID, 'm1', 'p1');
    useHeldQueue.getState().startSending(CHAT_ID, 'm1', 'p1');
    const { ctrl } = makeController();

    await ctrl.cancel();

    expect(useHeldQueue.getState().byChat[CHAT_ID]!.map((row) => row.claim?.started)).toEqual([true, undefined]);
    expect(useHeldQueue.getState().byChat[CHAT_ID]![1]).not.toHaveProperty('claim');
  });

  it('a held row sent, queued and edited there comes back in its place', async () => {
    useHeldQueue.getState().hold(CHAT_ID, { ...queuedRef('b', 1), content: 'B' });
    useHeldQueue.getState().hold(CHAT_ID, { ...queuedRef('c', 2), content: 'C' });
    noteQueued(CHAT_ID, { queuedMessageId: 'q', timestamp: useHeldQueue.getState().byChat[CHAT_ID]![0]!.timestamp });
    useHeldQueue.getState().remove(CHAT_ID, 'b');
    const { ctrl, acpClient } = makeController();
    await ctrl.load();
    acpClient.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'running' });
    acpClient.emitQueueState(CHAT_ID, [{ ...queuedRef('q', 9), content: 'B' }]);
    await ctrl.editQueued('q', 'B, reworded');
    acpClient.emitQueueState(CHAT_ID, [{ ...queuedRef('q', 9), content: 'B, reworded' }]);

    await ctrl.cancel();

    expect(useHeldQueue.getState().byChat[CHAT_ID]!.map((row) => row.content)).toEqual(['B, reworded', 'C']);
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
