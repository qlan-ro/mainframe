/**
 * The deferred `run.stopped` stop signal (D7, finding 10, long-chat-and-
 * streaming plan task U3): an idle `state_update` schedules `run.stopped`
 * `RUN_STOP_SETTLE_MS` (50ms) out, and ANY `run.started` — whatever its
 * source — cancels it before it fires. `dispose()` cancels it too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn().mockResolvedValue(['id-1']),
}));
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

import { CHAT_ID, makeChat, makeController, makeMsg } from './acp-test-kit';

beforeEach(() => {
  vi.clearAllMocks();
});

/** Runs a chat up to idle-just-happened: running, then idle (the 50ms stop is now armed but not yet fired). */
async function armPendingStop(
  ctrl: ReturnType<typeof makeController>['ctrl'],
  acpClient: ReturnType<typeof makeController>['acpClient'],
) {
  await ctrl.load();
  acpClient.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'running' });
  acpClient.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
  expect(ctrl.getState().runState).toEqual({ type: 'running' }); // still running — the stop hasn't fired yet
}

describe('deferred run.stopped — idle fires it only after 50ms', () => {
  it('flips to idle once the settle delay elapses, with nothing cancelling it', async () => {
    vi.useFakeTimers();
    try {
      const { ctrl, acpClient } = makeController();
      await armPendingStop(ctrl, acpClient);

      await vi.advanceTimersByTimeAsync(49);
      expect(ctrl.getState().runState).toEqual({ type: 'running' });
      await vi.advanceTimersByTimeAsync(1);
      expect(ctrl.getState().runState).toEqual({ type: 'idle' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('deferred run.stopped — any run.started cancels it', () => {
  it('a facade state_update running cancels the pending stop', async () => {
    vi.useFakeTimers();
    try {
      const { ctrl, acpClient } = makeController();
      await armPendingStop(ctrl, acpClient);

      acpClient.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'running' });
      await vi.advanceTimersByTimeAsync(50);
      expect(ctrl.getState().runState).toEqual({ type: 'running' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('the optimistic run.started on send (chat-actions.ts) cancels the pending stop', async () => {
    vi.useFakeTimers();
    try {
      const { ctrl, acpClient } = makeController();
      await armPendingStop(ctrl, acpClient);

      await ctrl.sendMessage(makeMsg('go again'));
      await vi.advanceTimersByTimeAsync(50);
      expect(ctrl.getState().runState).toEqual({ type: 'running' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a side-band chat.updated isRunning:true cancels the pending stop', async () => {
    vi.useFakeTimers();
    try {
      const { ctrl, acpClient, ws } = makeController();
      await armPendingStop(ctrl, acpClient);

      ctrl.subscribeLive();
      ws.pushEvent({ type: 'chat.updated', chat: makeChat({ isRunning: true }) });
      await vi.advanceTimersByTimeAsync(50);
      expect(ctrl.getState().runState).toEqual({ type: 'running' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('deferred run.stopped — dispose() cancels it', () => {
  it('a disposed controller never flips to idle once the settle delay elapses', async () => {
    vi.useFakeTimers();
    try {
      const { ctrl, acpClient } = makeController();
      await armPendingStop(ctrl, acpClient);

      ctrl.dispose();
      await vi.advanceTimersByTimeAsync(50);
      expect(ctrl.getState().runState).toEqual({ type: 'running' });
    } finally {
      vi.useRealTimers();
    }
  });
});
