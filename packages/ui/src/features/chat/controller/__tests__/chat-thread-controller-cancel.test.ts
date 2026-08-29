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

import { CHAT_ID, makeController } from './acp-test-kit';

beforeEach(() => {
  vi.clearAllMocks();
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
