import { beforeEach, expect, it, vi } from 'vitest';
import { getChat } from '../../../../lib/api/chats';
import { getActiveDaemon, setActiveDaemon } from '../../../../lib/daemon/active-daemon';
import { CHAT_ID, makeChat, makeController } from './acp-test-kit';

vi.mock('../../../../lib/api/chats', () => ({
  getChat: vi.fn(),
  getChatWorkflowRuns: vi.fn().mockResolvedValue([]),
  resumeChat: vi.fn().mockResolvedValue(undefined),
}));

const newer = '2026-11-25T18:01:00.000Z';
const older = '2026-11-25T18:00:00.000Z';

function setup() {
  const { ctrl, ws } = makeController();
  ctrl.subscribeLive();
  vi.mocked(getChat).mockClear();
  const broadcast = (overrides: Parameters<typeof makeChat>[0]) =>
    ws.pushEvent({ type: 'chat.updated', chat: makeChat(overrides) });
  return { ctrl, broadcast };
}

beforeEach(() => vi.mocked(getChat).mockReset());

it.each([older, newer])('applies a follow-up broadcast stamped %s', async (updatedAt) => {
  const { ctrl, broadcast } = setup();
  broadcast({ model: 'sonnet', updatedAt: newer });
  broadcast({ model: 'opus', updatedAt });
  expect(ctrl.getState().chatConfig?.model).toBe('opus');
});

it('applies the response without re-reading when the broadcast is missed', async () => {
  const { ctrl, broadcast } = setup();
  broadcast({ model: 'sonnet' });
  const chat = makeChat({ model: 'opus' });
  await ctrl.reconcileModelResponse(CHAT_ID, async () => chat);
  expect(ctrl.getState().chatConfig).toBe(chat);
  expect(getChat).not.toHaveBeenCalled();
});

it.each(['opus', 'sonnet'])('re-reads once after a broadcast reporting %s', async (model) => {
  const { ctrl, broadcast } = setup();
  broadcast({ model: 'sonnet' });
  const fresh = makeChat({ model: 'opus', planMode: true });
  vi.mocked(getChat).mockResolvedValueOnce(fresh);
  await ctrl.reconcileModelResponse(CHAT_ID, async () => {
    broadcast({ model, planMode: true });
    return makeChat({ model: 'opus', planMode: false });
  });
  expect(getChat).toHaveBeenCalledExactlyOnceWith(expect.any(Number), CHAT_ID);
  expect(ctrl.getState().chatConfig?.model).toBe('opus');
  expect(ctrl.getState().chatConfig?.planMode).toBe(true);
});

it('preserves a broadcast received during the re-read', async () => {
  const { ctrl, broadcast } = setup();
  vi.mocked(getChat).mockImplementationOnce(async () => {
    broadcast({ model: 'haiku' });
    return makeChat({ model: 'opus' });
  });
  await ctrl.reconcileModelResponse(CHAT_ID, async () => {
    broadcast({ model: 'sonnet' });
    return makeChat({ model: 'opus' });
  });
  expect(getChat).toHaveBeenCalledExactlyOnceWith(expect.any(Number), CHAT_ID);
  expect(ctrl.getState().chatConfig?.model).toBe('haiku');
});

it('re-reads when the response has no chat for the request', async () => {
  const { ctrl } = setup();
  const chat = makeChat({ adapterId: 'codex', model: 'gpt' });
  vi.mocked(getChat).mockResolvedValueOnce(chat);
  await ctrl.reconcileModelResponse(CHAT_ID, async () => makeChat({ id: 'unrelated' }));
  expect(getChat).toHaveBeenCalledExactlyOnceWith(expect.any(Number), CHAT_ID);
  expect(ctrl.getState().chatConfig).toBe(chat);
});

it('ignores a re-read for another chat and a broadcast for another chat', async () => {
  const { ctrl, broadcast } = setup();
  const chat = makeChat({ model: 'opus' });
  await ctrl.reconcileModelResponse(CHAT_ID, async () => {
    broadcast({ id: 'unrelated', model: 'haiku' });
    return chat;
  });
  expect(getChat).not.toHaveBeenCalled();
  vi.mocked(getChat).mockResolvedValueOnce(makeChat({ id: 'unrelated' }));
  await expect(ctrl.reconcileModelResponse(CHAT_ID, async () => undefined)).rejects.toThrow();
  expect(ctrl.getState().chatConfig).toBe(chat);
});

it('ignores a response after the active daemon changes', async () => {
  const { ctrl } = setup();
  const daemon = getActiveDaemon();
  try {
    await ctrl.reconcileModelResponse(CHAT_ID, async () => {
      setActiveDaemon({ ...daemon, id: 'other' });
      return makeChat({ model: 'opus' });
    });
    expect(getChat).not.toHaveBeenCalled();
    expect(ctrl.getState().chatConfig).toBeNull();
  } finally {
    setActiveDaemon(daemon);
  }
});
