/** Where the run in progress began, from the frames the daemon sends (`run-start.ts`). */
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
const STAGED = { itemCreationMarkers: true, replayComplete: true };
const CREATED = { _meta: { '_mainframe.dev': { created: true } } };
const says = (client: FakeAcpClient, id: string) =>
  client.emitUpdate(CHAT_ID, {
    sessionUpdate: 'agent_message',
    messageId: id,
    content: [{ type: 'text', text: id }],
    ...CREATED,
  });
async function attached() {
  const rig = makeController();
  await rig.ctrl.load();
  return rig;
}

const run = (ctrl: Awaited<ReturnType<typeof attached>>['ctrl']) => ctrl.getState().run;

describe('the run of a followed session', () => {
  it.each(['end_turn', 'cancelled', '_mainframe.dev/error', undefined] as const)(
    'is forgotten once idle, however it ended (%s)',
    async (reason) => {
      const { ctrl, acpClient } = await attached();
      says(acpClient, 'before');
      running(acpClient, 7);
      says(acpClient, 'a1');
      expect(run(ctrl)).toEqual({ after: 'before', confirmed: true });
      idle(acpClient, reason);
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
      const { messages: _messages, ...kept } = ctrl.getState();
      expect(kept.run).toBeNull();
      expect(JSON.stringify(kept)).not.toContain('stopReason');
    },
  );

  it('is another one when a queued prompt starts its turn at once', async () => {
    const { ctrl, acpClient } = await attached();
    running(acpClient, 7);
    says(acpClient, 'a1');
    idle(acpClient, 'end_turn');
    running(acpClient, 9);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(ctrl.getState().runState.type).toBe('running');
    expect(run(ctrl)).toEqual({ after: 'a1', confirmed: true });
  });

  it('begins at the send, and a steer begins none', async () => {
    const { ctrl, acpClient } = await attached();
    says(acpClient, 'before');
    await ctrl.sendMessage(makeMsg('Go'));
    expect(run(ctrl)).toEqual({ after: 'before', confirmed: false });
    running(acpClient, 7);
    acpClient.emitUpdate(CHAT_ID, userMessageUpdate('u1', 'Go'));
    says(acpClient, 'a1');
    const begun = run(ctrl);
    expect(begun).toEqual({ after: 'before', confirmed: true });
    await ctrl.sendMessage(makeMsg('More'));
    acpClient.emitUpdate(CHAT_ID, userMessageUpdate('u2', 'More'));
    running(acpClient, 7);
    expect(run(ctrl)).toBe(begun);
  });

  it('outlives a steer that could not be sent', async () => {
    const { ctrl, acpClient } = await attached();
    running(acpClient, 7);
    says(acpClient, 'a1');
    acpClient.prompt = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(ctrl.sendMessage(makeMsg('More'))).rejects.toThrow('offline');
    expect(ctrl.getState().runState.type).toBe('running');
    expect(run(ctrl)).toEqual({ after: null, confirmed: true });
    // The same send with nothing running did start a run, and failed it.
    idle(acpClient, 'end_turn');
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await expect(ctrl.sendMessage(makeMsg('More'))).rejects.toThrow('offline');
    expect(ctrl.getState().runState.type).toBe('error');
    expect(run(ctrl)).toBeNull();
  });
});

describe('a session loaded while it runs', () => {
  it('has no known start', async () => {
    const rig = makeController(CHAT_ID, { capabilities: STAGED });
    const { ctrl, acpClient } = rig;
    acpClient.nextResumeMeta = { itemCount: 3, fullReplay: true };
    const loading = ctrl.load();
    await flushMicrotasks();
    acpClient.emitUpdate(CHAT_ID, { ...userMessageUpdate('u1', 'Go'), ...CREATED });
    says(acpClient, 'a1');
    running(acpClient, 7);
    acpClient.emitReplayComplete(CHAT_ID);
    await loading;
    expect(run(ctrl)).toEqual({ confirmed: true });
  });

  it('has none at the end of what a reconnect brought', async () => {
    const { ctrl, acpClient } = makeController(CHAT_ID, { capabilities: STAGED });
    acpClient.nextResumeMeta = { itemCount: 1, fullReplay: true };
    const loading = ctrl.load();
    await flushMicrotasks();
    acpClient.emitUpdate(CHAT_ID, { ...userMessageUpdate('u1', 'Go'), ...CREATED });
    idle(acpClient);
    acpClient.emitReplayComplete(CHAT_ID);
    await loading;
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    // The resume that follows the gap replays from the settled item on.
    acpClient.nextResumeMeta = { itemCount: 1 };
    acpClient.emitGap();
    await flushMicrotasks();
    says(acpClient, 'a1');
    running(acpClient, 7);
    acpClient.emitReplayComplete(CHAT_ID);
    await flushMicrotasks();
    expect(run(ctrl)).toEqual({ confirmed: true });
  });
});
