import { expect, it, vi } from 'vitest';
import { getChat } from '../../../../lib/api/chats';
import { CHAT_ID, makeChat, makeController } from './acp-test-kit';

vi.mock('../../../../lib/api/chats', () => ({
  getChat: vi.fn(),
  getChatWorkflowRuns: vi.fn().mockResolvedValue([]),
  resumeChat: vi.fn().mockResolvedValue(undefined),
}));

const newer = '2026-11-25T18:01:00Z';
const older = '2026-11-25T18:00:00Z';

it('applies a model response ahead of broadcasts and ignores an older broadcast', async () => {
  const { ctrl, ws } = makeController();
  ctrl.subscribeLive();
  await ctrl.reconcileModelResponse(CHAT_ID, makeChat({ model: 'opus', updatedAt: newer }));
  expect(ctrl.getState().chatConfig?.model).toBe('opus');
  ws.pushEvent({ type: 'chat.updated', chat: makeChat({ model: 'sonnet', updatedAt: older }) });
  expect(ctrl.getState().chatConfig?.model).toBe('opus');
});

it('ignores a stale response even when the newer broadcast only changed the timestamp', async () => {
  const { ctrl, ws } = makeController();
  ctrl.subscribeLive();
  ws.pushEvent({ type: 'chat.updated', chat: makeChat({ model: 'sonnet', updatedAt: older }) });
  ws.pushEvent({ type: 'chat.updated', chat: makeChat({ model: 'sonnet', updatedAt: newer }) });
  await ctrl.reconcileModelResponse(CHAT_ID, makeChat({ model: 'opus', updatedAt: older }));
  expect(ctrl.getState().chatConfig?.model).toBe('sonnet');
});

it('reloads chat config when the model response has no chat for the request', async () => {
  const { ctrl } = makeController();
  const chat = makeChat({ adapterId: 'codex', model: 'gpt', updatedAt: newer });
  vi.mocked(getChat).mockResolvedValueOnce(chat);
  await ctrl.reconcileModelResponse(CHAT_ID, makeChat({ id: 'unrelated' }));
  expect(getChat).toHaveBeenCalledWith(expect.any(Number), CHAT_ID);
  expect(ctrl.getState().chatConfig).toBe(chat);
});
