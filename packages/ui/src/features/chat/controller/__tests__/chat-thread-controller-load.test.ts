/**
 * Behavior tests for AcpChatController.load()/refresh().
 *
 * load() seeds the config from REST (getChat) then connects the facade
 * client and attaches the plane (full replay). Covers:
 *  1. getChat rejects → loadState 'error' with the rejected Error captured.
 *  2. refresh() after a failure recovers loadState to 'ready'.
 *  3. Happy-path: getChat resolves → loadState 'ready'.
 *  4. Seed-once: a second load() after 'ready' does not re-fetch; refresh()
 *     always forces a re-fetch (the #275 second-mount-must-not-reseed guard,
 *     now expressed as "don't re-attach", not "don't re-render history" —
 *     the transcript itself is owned by the plane's own refusal guard,
 *     covered in acp-session-plane.test.ts).
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

import { getChat } from '../../../../lib/api/chats';
import { makeChat, makeController } from './acp-test-kit';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AcpChatController.load — getChat rejects', () => {
  it('sets loadState to error with the rejected Error captured', async () => {
    const boom = new Error('boom');
    vi.mocked(getChat).mockRejectedValueOnce(boom);
    const { ctrl } = makeController();

    await ctrl.load();

    expect(ctrl.getState().loadState).toEqual({ type: 'error', error: boom });
  });
});

describe('AcpChatController.refresh — recovers from a prior failure', () => {
  it('transitions loadState back to ready when refresh resolves after a failure', async () => {
    vi.mocked(getChat).mockRejectedValueOnce(new Error('transient'));
    vi.mocked(getChat).mockResolvedValueOnce(makeChat());
    const { ctrl } = makeController();

    await ctrl.load();
    expect(ctrl.getState().loadState.type).toBe('error');

    await ctrl.refresh();

    expect(ctrl.getState().loadState.type).toBe('ready');
  });
});

describe('AcpChatController.load — getChat resolves', () => {
  it('sets loadState to ready', async () => {
    vi.mocked(getChat).mockResolvedValueOnce(makeChat());
    const { ctrl } = makeController();

    await ctrl.load();

    expect(ctrl.getState().loadState.type).toBe('ready');
  });

  it('mirrors the resolved chat into chatConfig', async () => {
    vi.mocked(getChat).mockResolvedValueOnce(makeChat({ model: 'opus' }));
    const { ctrl } = makeController();

    await ctrl.load();

    expect(ctrl.getState().chatConfig?.model).toBe('opus');
  });
});

describe('AcpChatController.load — seeds once per controller', () => {
  it('does not re-fetch on a second load() after the first settled ready', async () => {
    vi.mocked(getChat).mockResolvedValue(makeChat());
    const { ctrl } = makeController();

    await ctrl.load();
    expect(getChat).toHaveBeenCalledTimes(1);

    await ctrl.load();

    expect(getChat).toHaveBeenCalledTimes(1);
  });

  it('refresh() still re-fetches after a ready load', async () => {
    vi.mocked(getChat).mockResolvedValue(makeChat());
    const { ctrl } = makeController();

    await ctrl.load();
    await ctrl.refresh();

    expect(getChat).toHaveBeenCalledTimes(2);
  });

  it('retries after a failed load — an error state is not a seed', async () => {
    vi.mocked(getChat).mockRejectedValueOnce(new Error('transient'));
    vi.mocked(getChat).mockResolvedValueOnce(makeChat());
    const { ctrl } = makeController();

    await ctrl.load();
    await ctrl.load();

    expect(getChat).toHaveBeenCalledTimes(2);
    expect(ctrl.getState().loadState.type).toBe('ready');
  });
});
