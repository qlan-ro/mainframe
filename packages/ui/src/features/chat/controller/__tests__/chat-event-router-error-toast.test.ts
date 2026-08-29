/**
 * Behavior tests: routeDaemonEvent raises an mfToast on a daemon `error` event
 * targeting this chat (the still-live branch in chat-event-router.ts).
 *
 * Recovered from the deleted chat-thread-controller-cancel-failed.test.ts
 * (commit fd185431's "daemon error toast" describe block), which was removed
 * along with the cancel_failed toast tests it shared a file with — that
 * removal dropped coverage for an unrelated, still-live branch. Re-homed here
 * as its own file so it survives independently of the cancel_failed cleanup.
 * Side-band mechanism, unaffected by the facade cutover.
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
import { CHAT_ID, makeController } from './acp-test-kit';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('daemon error toast', () => {
  it('surfaces a daemon run error targeting this chat via mfToast.error', () => {
    const { ctrl, ws } = makeController();
    ctrl.subscribeLive();

    ws.pushEvent({ type: 'error', chatId: CHAT_ID, error: 'the CLI process failed to start' });

    expect(vi.mocked(mfToast.error)).toHaveBeenCalledOnce();
    expect(vi.mocked(mfToast.error).mock.calls[0]![0]).toBe('Agent run failed');
    expect(vi.mocked(mfToast.error).mock.calls[0]![1]).toEqual({ description: 'the CLI process failed to start' });
  });

  it('does NOT toast for an error targeting a different chat', () => {
    const { ctrl, ws } = makeController();
    ctrl.subscribeLive();

    ws.pushEvent({ type: 'error', chatId: 'other-chat', error: 'boom' });

    expect(vi.mocked(mfToast.error)).not.toHaveBeenCalled();
  });
});
