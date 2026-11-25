/** The runs the controller records from the frames the daemon sends (`run-records.ts`). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StopReason } from '@qlan-ro/mainframe-types';

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

import {
  CHAT_ID,
  flushMicrotasks,
  makeController,
  makeMsg,
  userMessageUpdate,
  type FakeAcpClient,
} from './acp-test-kit';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const SETTLE_MS = 50;
const running = (client: FakeAcpClient, startedAtMs?: number) =>
  client.emitUpdate(CHAT_ID, {
    sessionUpdate: 'state_update',
    state: 'running',
    ...(startedAtMs !== undefined && { _meta: { '_mainframe.dev': { startedAtMs } } }),
  });
const idle = (client: FakeAcpClient, stopReason?: StopReason) =>
  client.emitUpdate(CHAT_ID, { sessionUpdate: 'state_update', state: 'idle', ...(stopReason && { stopReason }) });
const CREATED = { _meta: { '_mainframe.dev': { created: true } } };
const says = (client: FakeAcpClient, id: string) =>
  client.emitUpdate(CHAT_ID, {
    sessionUpdate: 'agent_message',
    messageId: id,
    content: [{ type: 'text', text: id }],
    ...CREATED,
  });
const at = (id: string) => ({ id, parts: 1 });

async function attached() {
  const rig = makeController();
  await rig.ctrl.load();
  return rig;
}

describe('the runs of a followed session', () => {
  it.each(['end_turn', 'cancelled', '_mainframe.dev/error'] as const)('end with the reason %s', async (reason) => {
    const { ctrl, acpClient } = await attached();
    says(acpClient, 'before');
    running(acpClient, 7);
    says(acpClient, 'a1');
    idle(acpClient, reason);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(ctrl.getState().runs).toEqual([
      { after: at('before'), exact: true, startedAtMs: 7, end: { until: at('a1'), reason } },
    ]);
  });

  it('are two when a queued prompt starts its turn at once', async () => {
    const { ctrl, acpClient } = await attached();
    running(acpClient, 7);
    says(acpClient, 'a1');
    idle(acpClient, 'end_turn');
    running(acpClient, 9);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(ctrl.getState().runState.type).toBe('running');
    expect(ctrl.getState().runs).toMatchObject([
      { after: null, end: { until: at('a1'), reason: 'end_turn' } },
      { after: at('a1'), exact: true, startedAtMs: 9 },
    ]);
  });

  it('begin at the send, and a steer begins none', async () => {
    const { ctrl, acpClient } = await attached();
    says(acpClient, 'before');
    await ctrl.sendMessage(makeMsg('Go'));
    running(acpClient, 7);
    acpClient.emitUpdate(CHAT_ID, userMessageUpdate('u1', 'Go'));
    says(acpClient, 'a1');
    await ctrl.sendMessage(makeMsg('More'));
    acpClient.emitUpdate(CHAT_ID, userMessageUpdate('u2', 'More'));
    running(acpClient, 7);
    expect(ctrl.getState().runs).toMatchObject([{ after: at('before'), exact: true, startedAtMs: 7 }]);
    expect(ctrl.getState().runs).toHaveLength(1);
    expect(ctrl.getState().runs[0]!.end).toBeUndefined();
  });

  it('outlive a steer that could not be sent', async () => {
    const { ctrl, acpClient } = await attached();
    running(acpClient, 7);
    says(acpClient, 'a1');
    acpClient.prompt = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(ctrl.sendMessage(makeMsg('More'))).rejects.toThrow('offline');
    expect(ctrl.getState().runState.type).toBe('running');
    expect(ctrl.getState().runs).toMatchObject([{ after: null, exact: true }]);
    expect(ctrl.getState().runs[0]!.end).toBeUndefined();
    // The same send with nothing running did start a run, and failed it.
    idle(acpClient, 'end_turn');
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await expect(ctrl.sendMessage(makeMsg('More'))).rejects.toThrow('offline');
    expect(ctrl.getState().runState.type).toBe('error');
    expect(ctrl.getState().runs[1]).toMatchObject({ after: at('a1'), end: { until: at('a1') } });
  });
});

describe('a session loaded while it runs', () => {
  it('is not known to have begun before its last message', async () => {
    const rig = makeController(CHAT_ID, { capabilities: { itemCreationMarkers: true, replayComplete: true } });
    const { ctrl, acpClient } = rig;
    acpClient.nextResumeMeta = { itemCount: 3, fullReplay: true };
    const loading = ctrl.load();
    await flushMicrotasks();
    acpClient.emitUpdate(CHAT_ID, { ...userMessageUpdate('u1', 'Go'), ...CREATED });
    says(acpClient, 'a1');
    running(acpClient, 7);
    acpClient.emitReplayComplete(CHAT_ID);
    await loading;
    expect(ctrl.getState().runs).toEqual([{ after: at('u1'), exact: false, startedAtMs: 7 }]);
  });
});
