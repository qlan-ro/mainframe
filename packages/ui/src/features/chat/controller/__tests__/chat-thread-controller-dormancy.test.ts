/**
 * Behavior tests for AcpChatController dormancy split (desktop-cutover pass).
 *
 * subscribeState  — state-change notifications, never opens the side-band WS.
 * subscribeLive   — opens the side-band WS sub (config/queued/background/
 *                    worktree); ref-counted + idempotent; no-op on a
 *                    __LOCALID_* thread; warms resumeChat immediately (no
 *                    ack-gating — that mechanism is retired, see
 *                    chat-ws-subscription.test.ts).
 * The ACP facade plane is NOT gated by subscribeLive — it attaches at
 * load() and keeps streaming while the thread is dormant (switched away
 * from), which is what makes a switch-back need no re-seed. setRemoteId
 * adopts the daemon id and redirects both planes.
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

import { resumeChat, getChat } from '../../../../lib/api/chats';
import { AcpChatController } from '../acp-chat-controller';
import { CHAT_ID, PORT, makeChat, makeController, makeFakeWs } from './acp-test-kit';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dormancy — subscribeState never touches the side-band WS', () => {
  it('does not call resumeChat when only subscribeState is attached', () => {
    const { ctrl } = makeController();

    ctrl.subscribeState(() => {});

    expect(resumeChat).not.toHaveBeenCalled();
  });

  it('invokes the listener on a state change and stops after teardown', () => {
    const { ctrl } = makeController();
    let calls = 0;
    const off = ctrl.subscribeState(() => (calls += 1));

    ctrl.setRemoteId('chat-other');
    expect(calls).toBeGreaterThanOrEqual(1);

    off();
    const before = calls;
    ctrl.setRemoteId('chat-other'); // idempotent same-id — no further dispatch
    expect(calls).toBe(before);
  });
});

describe('dormancy — subscribeLive is ref-counted, idempotent, and warms immediately', () => {
  it('subscribes once and warms resumeChat with no ack needed', () => {
    const { ctrl } = makeController();

    ctrl.subscribeLive();

    expect(resumeChat).toHaveBeenCalledWith(PORT, CHAT_ID);
  });

  it('does not open a second sub on a second subscribeLive call', () => {
    const subscribeSpy = vi.fn();
    const { ctrl, ws } = makeController();
    (ws.fakeClient as unknown as { subscribe: typeof subscribeSpy }).subscribe = subscribeSpy;

    ctrl.subscribeLive();
    ctrl.subscribeLive();

    expect(subscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes only when the last live ref releases; teardown is idempotent', () => {
    const unsubscribeSpy = vi.fn();
    const { ctrl, ws } = makeController();
    (ws.fakeClient as unknown as { unsubscribe: typeof unsubscribeSpy }).unsubscribe = unsubscribeSpy;

    const stop1 = ctrl.subscribeLive();
    const stop2 = ctrl.subscribeLive();
    stop1();
    expect(unsubscribeSpy).not.toHaveBeenCalled();

    stop2();
    stop2();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('dormancy — __LOCALID_* never subscribes live', () => {
  it('is a no-op: no ws.subscribe, no resumeChat, a no-op teardown', () => {
    const subscribeSpy = vi.fn();
    const ws = makeFakeWs();
    (ws.fakeClient as unknown as { subscribe: typeof subscribeSpy }).subscribe = subscribeSpy;
    const ctrl = new AcpChatController('__LOCALID_a', PORT, ws.fakeClient);

    const stop = ctrl.subscribeLive();
    stop();

    expect(subscribeSpy).not.toHaveBeenCalled();
    expect(resumeChat).not.toHaveBeenCalled();
  });
});

describe('dormancy — setRemoteId adopts the daemon id for both planes', () => {
  it('routes a subsequent subscribeLive to the remote id', () => {
    const subscribeSpy = vi.fn();
    const ws = makeFakeWs();
    (ws.fakeClient as unknown as { subscribe: typeof subscribeSpy }).subscribe = subscribeSpy;
    const ctrl = new AcpChatController('__LOCALID_a', PORT, ws.fakeClient);

    ctrl.setRemoteId('chat-99');
    ctrl.subscribeLive();

    expect(subscribeSpy).toHaveBeenCalledWith('chat-99');
  });

  it('throws on a second setRemoteId with a different id, and is a no-op with the same id', () => {
    const ws = makeFakeWs();
    const ctrl = new AcpChatController('__LOCALID_a', PORT, ws.fakeClient);

    ctrl.setRemoteId('chat-99');

    expect(() => ctrl.setRemoteId('chat-other')).toThrow();
    expect(() => ctrl.setRemoteId('chat-99')).not.toThrow();
  });
});

describe('dormancy — the ACP facade plane streams without subscribeLive', () => {
  it('load() attaches the plane and a session update reaches state.messages with no live side-band sub', async () => {
    vi.mocked(getChat).mockResolvedValue(makeChat());
    const { ctrl, acpClient } = makeController();

    await ctrl.load();
    // No subscribeLive() call anywhere — the thread is "dormant" on the side-band.
    acpClient.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message',
      messageId: 'm1',
      content: [{ type: 'text', text: 'still here' }],
    });

    expect(ctrl.getState().messages).toEqual([
      expect.objectContaining({ role: 'assistant', id: 'm1', content: [{ type: 'text', text: 'still here' }] }),
    ]);
  });
});
