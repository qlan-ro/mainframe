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

/** Two picks with no broadcasts: opens the request of each and returns how to finish it. */
function twoPicks(ctrl: ReturnType<typeof setup>['ctrl']) {
  const start = (model: string) => {
    let finish!: () => void;
    let refuse!: () => void;
    const done = ctrl.reconcileModelResponse(
      CHAT_ID,
      () =>
        new Promise((resolve, reject) => {
          finish = () => resolve(makeChat({ model }));
          refuse = () => reject(new Error('refused'));
        }),
    );
    return { done, finish, refuse };
  };
  return { first: start('opus'), second: start('haiku') };
}

it('a late response to an older pick never replaces the newer pick', async () => {
  const { ctrl } = setup();
  const { first, second } = twoPicks(ctrl);
  second.finish();
  await second.done;
  expect(ctrl.getState().chatConfig?.model).toBe('haiku');
  vi.mocked(getChat).mockResolvedValueOnce(makeChat({ model: 'haiku' }));
  first.finish();
  await first.done;
  expect(ctrl.getState().chatConfig?.model).toBe('haiku');
});

it('an older pick’s re-read that outlasts the newer response is dropped', async () => {
  const { ctrl } = setup();
  const { first, second } = twoPicks(ctrl);
  let answer!: () => void;
  vi.mocked(getChat).mockImplementationOnce(
    () => new Promise((resolve) => (answer = () => resolve(makeChat({ model: 'opus' })))),
  );
  first.finish();
  await vi.waitFor(() => expect(getChat).toHaveBeenCalledOnce());
  vi.mocked(getChat).mockResolvedValueOnce(makeChat({ model: 'haiku' }));
  second.finish();
  await second.done;
  answer();
  await first.done;
  expect(ctrl.getState().chatConfig?.model).toBe('haiku');
});

it('shows the older pick when the newer one is refused', async () => {
  const { ctrl } = setup();
  const { first, second } = twoPicks(ctrl);
  second.refuse();
  await expect(second.done).rejects.toThrow('refused');
  vi.mocked(getChat).mockResolvedValueOnce(makeChat({ model: 'opus' }));
  first.finish();
  await first.done;
  expect(ctrl.getState().chatConfig?.model).toBe('opus');
});

it.each(['older', 'newer'])('the later re-read wins when the %s one answers first', async (order) => {
  const { ctrl, broadcast } = setup();
  const { first, second } = twoPicks(ctrl);
  broadcast({ model: 'sonnet' });
  const answers: Array<() => void> = [];
  const answer = (model: string) => () =>
    new Promise<ReturnType<typeof makeChat>>((resolve) => answers.push(() => resolve(makeChat({ model }))));
  vi.mocked(getChat).mockImplementationOnce(answer('opus')).mockImplementationOnce(answer('haiku'));
  first.finish();
  await vi.waitFor(() => expect(answers).toHaveLength(1));
  second.finish();
  await vi.waitFor(() => expect(answers).toHaveLength(2));
  const [older, newest] = answers as [() => void, () => void];
  (order === 'older' ? [older, newest] : [newest, older]).forEach((reply) => reply());
  await Promise.all([first.done, second.done]);
  expect(ctrl.getState().chatConfig?.model).toBe('haiku');
});
