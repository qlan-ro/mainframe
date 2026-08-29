/**
 * Behavior tests: routeDaemonEvent raises a persistent permission toast on
 * chat.trustRequired (NOT an error toast, and no run-failure state event) —
 * the untrusted-workspace advisory is non-fatal. The toast's Trust action
 * calls trustWorkspace(0, chatId). Side-band mechanism, unchanged by the
 * facade cutover — routed through ChatWsSubscription exactly as before.
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
  trustWorkspace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../lib/api/git', () => ({
  acceptWorktreeOffer: vi.fn().mockResolvedValue(undefined),
  dismissWorktreeOffer: vi.fn().mockResolvedValue(undefined),
}));

import { mfToast } from '@/lib/toast';
import { trustWorkspace } from '../../../../lib/api/chats';
import { CHAT_ID, makeController } from './acp-test-kit';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('chat.trustRequired toast', () => {
  it('fires mfToast.permission (not mfToast.error) when chatId matches', () => {
    const { ctrl, ws } = makeController();
    ctrl.subscribeLive();

    ws.pushEvent({ type: 'chat.trustRequired', chatId: CHAT_ID, projectPath: '/p' });

    expect(vi.mocked(mfToast.permission)).toHaveBeenCalledOnce();
    expect(vi.mocked(mfToast.error)).not.toHaveBeenCalled();
  });

  it('does NOT fire mfToast.permission for a different chat', () => {
    const { ctrl, ws } = makeController();
    ctrl.subscribeLive();

    ws.pushEvent({ type: 'chat.trustRequired', chatId: 'other-chat', projectPath: '/p' });

    expect(vi.mocked(mfToast.permission)).not.toHaveBeenCalled();
  });

  it('does not dispatch a run-failure state change', () => {
    const { ctrl, ws } = makeController();
    ctrl.subscribeLive();
    const before = ctrl.getState().runState;

    ws.pushEvent({ type: 'chat.trustRequired', chatId: CHAT_ID, projectPath: '/p' });

    expect(ctrl.getState().runState).toBe(before);
  });

  it('clicking the toast action invokes trustWorkspace(0, chatId)', () => {
    const { ctrl, ws } = makeController();
    ctrl.subscribeLive();

    ws.pushEvent({ type: 'chat.trustRequired', chatId: CHAT_ID, projectPath: '/p' });

    const call = vi.mocked(mfToast.permission).mock.calls[0]!;
    const opts = call[1] as { action?: { onClick: () => void } };
    opts.action?.onClick();

    expect(vi.mocked(trustWorkspace)).toHaveBeenCalledWith(0, CHAT_ID);
  });
});
