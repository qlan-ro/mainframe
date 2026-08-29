/**
 * Behavior tests for AcpChatController.load() on a __LOCALID_* thread (HIGH-2).
 *
 * A brand-new local thread has no daemon chat yet, so load() must NOT hit
 * REST with the synthetic __LOCALID_* id. After setRemoteId adopts a real
 * id, the initial load runs against that real id.
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
import { AcpChatController } from '../acp-chat-controller';
import { PORT, flushMicrotasks, makeChat, makeFakeAcpClient, makeFakeWs } from './acp-test-kit';

const LOCAL_ID = '__LOCALID_abc';
const REMOTE_ID = 'chat-real-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AcpChatController.load — __LOCALID_* thread', () => {
  it('does not call getChat and leaves loadState idle', async () => {
    const acpClient = makeFakeAcpClient();
    const ws = makeFakeWs();
    const ctrl = new AcpChatController(LOCAL_ID, PORT, ws.fakeClient, () => acpClient);

    await ctrl.load();
    await flushMicrotasks();

    expect(getChat).not.toHaveBeenCalled();
    expect(ctrl.getState().loadState.type).toBe('idle');
  });
});

describe('AcpChatController.setRemoteId — triggers the initial load', () => {
  it('loads against the real id after adopting it (never the local id)', async () => {
    vi.mocked(getChat).mockResolvedValue(makeChat({ id: REMOTE_ID }));
    const acpClient = makeFakeAcpClient();
    const ws = makeFakeWs();
    const ctrl = new AcpChatController(LOCAL_ID, PORT, ws.fakeClient, () => acpClient);

    ctrl.setRemoteId(REMOTE_ID);
    await flushMicrotasks();

    const calls = vi.mocked(getChat).mock.calls;
    expect(calls.some((args) => args[1] === REMOTE_ID)).toBe(true);
    expect(calls.some((args) => args[1] === LOCAL_ID)).toBe(false);
    expect(acpClient.resumeCalls.some((c) => c.sessionId === REMOTE_ID)).toBe(true);
  });

  it('settles loadState to ready after the real-id load resolves', async () => {
    vi.mocked(getChat).mockResolvedValue(makeChat({ id: REMOTE_ID }));
    const acpClient = makeFakeAcpClient();
    const ws = makeFakeWs();
    const ctrl = new AcpChatController(LOCAL_ID, PORT, ws.fakeClient, () => acpClient);

    ctrl.setRemoteId(REMOTE_ID);
    await flushMicrotasks();

    expect(ctrl.getState().loadState.type).toBe('ready');
  });

  // Regression: state.chatId (every extras.state.chatId reader — composer
  // tuning, the diff-expand fetch, the @-file search scope) must flip to the
  // daemon id synchronously, before the async load resolves.
  it('flips state.chatId to the real id synchronously, before the load resolves', () => {
    const ws = makeFakeWs();
    const ctrl = new AcpChatController(LOCAL_ID, PORT, ws.fakeClient, () => makeFakeAcpClient());

    ctrl.setRemoteId(REMOTE_ID);

    expect(ctrl.getState().chatId).toBe(REMOTE_ID);
  });
});
