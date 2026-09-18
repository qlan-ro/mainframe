/**
 * Behavior tests for AcpChatController dormancy split (D2/D4, todo #350 T33).
 *
 * subscribeState  — state-change notifications, never opens the side-band WS.
 * subscribeLive   — opens the side-band WS sub (config/queued/background/
 *                    worktree); ref-counted + idempotent; no-op on a
 *                    __LOCALID_* thread; warms resumeChat immediately (no
 *                    ack-gating — that mechanism is retired, see
 *                    chat-ws-subscription.test.ts).
 * setActive       — gates the ACP facade plane's SUBSCRIPTION (session/resume
 *                    + listeners). An inactive chat still loads (config
 *                    seed + client bind, so prompt/cancel/reply work) but
 *                    does not stream — `_mainframe.dev/session_detach` tells
 *                    the daemon, and the daemon stops encoding/pushing for
 *                    it. Switch-back reactivates from the last settled item,
 *                    not a full replay — the accumulator survives a detach.
 * setRemoteId     — adopts the daemon id and redirects both planes; a
 *                    `__LOCALID_*` thread can be marked active before
 *                    adoption (nothing to attach to yet), and adoption
 *                    re-checks activation.
 *
 * Most other controller suites use `makeController()`'s `active: true`
 * default (a real session almost always has exactly one focused thread) —
 * these tests pass `active: false` explicitly, or drive `setActive` on a
 * directly-constructed controller, to exercise the gate itself.
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
import { CHAT_ID, PORT, makeChat, makeController, makeFakeAcpClient, makeFakeWs, makeMsg } from './acp-test-kit';

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

describe('dormancy — an inactive thread detaches from the facade (D2, T33)', () => {
  it('going inactive sends session_detach and a later session/update dispatches nothing', async () => {
    vi.mocked(getChat).mockResolvedValue(makeChat());
    const { ctrl, acpClient } = makeController(CHAT_ID, { active: false });
    ctrl.setActive(true);
    await ctrl.load();
    expect(acpClient.resumeCalls.some((c) => c.sessionId === CHAT_ID)).toBe(true);

    ctrl.setActive(false);

    expect(acpClient.detachCalls).toEqual([CHAT_ID]);
    acpClient.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message',
      messageId: 'm1',
      content: [{ type: 'text', text: 'nobody is listening' }],
    });
    expect(ctrl.getState().messages).toEqual([]);
  });

  it('loading while inactive still binds the client — prompt/cancel/reply work from a dormant chat', async () => {
    vi.mocked(getChat).mockResolvedValue(makeChat());
    const { ctrl, acpClient } = makeController(CHAT_ID, { active: false });

    await ctrl.load();

    expect(acpClient.resumeCalls).toHaveLength(0); // never subscribed
    await ctrl.sendMessage(makeMsg('hi'));
    expect(acpClient.promptCalls).toHaveLength(1);
  });
});

describe('dormancy — switch-back resumes from the last settled item, not a full replay (D2, T33)', () => {
  it('reactivating after a detach resumes with an item cursor, not a fresh start', async () => {
    vi.mocked(getChat).mockResolvedValue(makeChat());
    const { ctrl, acpClient } = makeController();
    await ctrl.load();
    acpClient.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message',
      messageId: 'm1',
      content: [{ type: 'text', text: 'done' }],
    });
    acpClient.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });

    ctrl.setActive(false);
    ctrl.setActive(true);
    await new Promise((r) => setTimeout(r, 0));

    const last = acpClient.resumeCalls[acpClient.resumeCalls.length - 1]!;
    expect(last).toEqual({ sessionId: CHAT_ID, cursor: { type: 'item', itemId: 'm1' } });
  });
});

describe('dormancy — a new thread attaches once its remote id is adopted (D2, T33)', () => {
  it('marking a __LOCALID_* thread active before adoption attaches a start resume once setRemoteId runs', async () => {
    vi.mocked(getChat).mockResolvedValue(makeChat({ id: 'chat-adopted' }));
    const acpClient = makeFakeAcpClient();
    const ws = makeFakeWs();
    const ctrl = new AcpChatController('__LOCALID_new', PORT, ws.fakeClient, () => acpClient);

    ctrl.setActive(true); // nothing to attach yet — no remote id
    expect(acpClient.resumeCalls).toHaveLength(0);

    ctrl.setRemoteId('chat-adopted');
    await new Promise((r) => setTimeout(r, 0));

    expect(acpClient.resumeCalls).toContainEqual({ sessionId: 'chat-adopted', cursor: { type: 'start' } });
  });
});
