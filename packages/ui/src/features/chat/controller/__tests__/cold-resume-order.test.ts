import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../../lib/api/attachments', () => ({ uploadAttachments: vi.fn() }));
vi.mock('../../../../lib/api/chats', () => ({
  getChat: vi.fn().mockResolvedValue(null),
  getChatWorkflowRuns: vi.fn().mockResolvedValue([]),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn(),
  editQueuedMessage: vi.fn(),
}));
vi.mock('../../../../lib/api/git', () => ({ acceptWorktreeOffer: vi.fn(), dismissWorktreeOffer: vi.fn() }));
vi.mock('@/lib/toast', () => ({ mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
import { resumeChat } from '../../../../lib/api/chats';
import { AcpChatController } from '../acp-chat-controller';
import { CHAT_ID, PORT, makeFakeWs, makeFakeAcpClient } from './acp-test-kit';

beforeEach(() => vi.clearAllMocks());
it.each([true, false])('waits for lifecycle warm-up before attaching (still active: %s)', async (active) => {
  let warmed!: () => void;
  vi.mocked(resumeChat).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      warmed = resolve;
    }),
  );
  const client = makeFakeAcpClient();
  const ctrl = new AcpChatController(CHAT_ID, PORT, makeFakeWs().fakeClient, () => client);
  ctrl.setActive(true);
  const stop = ctrl.subscribeLive();
  const loaded = ctrl.load();
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.resumeCalls).toHaveLength(0);
    if (!active) ctrl.setActive(false);
    warmed();
    await loaded;
    expect(client.resumeCalls).toHaveLength(active ? 1 : 0);
    expect(ctrl.getState().loadState.type).toBe('ready');
  } finally {
    warmed();
    stop();
    ctrl.dispose();
  }
});

it('still reads facade history when the lifecycle warm-up fails', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(resumeChat).mockRejectedValueOnce(new Error('warm-up failed'));
  const client = makeFakeAcpClient();
  const ctrl = new AcpChatController(CHAT_ID, PORT, makeFakeWs().fakeClient, () => client);
  ctrl.setActive(true);
  const stop = ctrl.subscribeLive();
  try {
    await ctrl.load();
    expect(client.resumeCalls).toHaveLength(1);
    expect(ctrl.getState().loadState.type).toBe('ready');
    expect(warn).toHaveBeenCalled();
  } finally {
    stop();
    ctrl.dispose();
    warn.mockRestore();
  }
});

it.each([true, false])('coordinates warm-up for a preloaded inactive controller (still active: %s)', async (active) => {
  let warmed!: () => void;
  const client = makeFakeAcpClient();
  const ctrl = new AcpChatController(CHAT_ID, PORT, makeFakeWs().fakeClient, () => client);
  await ctrl.load();
  vi.mocked(resumeChat).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      warmed = resolve;
    }),
  );
  const stop = ctrl.subscribeLive();
  ctrl.setActive(true);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.resumeCalls).toHaveLength(0);
    if (!active) ctrl.setActive(false);
    warmed();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.resumeCalls).toHaveLength(active ? 1 : 0);
  } finally {
    warmed();
    stop();
    ctrl.dispose();
  }
});
